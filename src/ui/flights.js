// Meine Fahrten (design board): saved flights of the Kennung, open / share / delete; Kennung & logo;
// defaults (display name, standard balloon, PIC) that prefill the report.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast, confirmDialog, copyText } from '../util/dom.js';
import { fmtInt, fmtBytes, fmtDateUTC, fmtDurationClock, fmtDateTimeUTC } from '../util/format.js';
import { makeUnits } from '../util/units.js';
import { state, bus } from '../state.js';
import { api, ApiError } from '../api.js';
import { session, setMe, clearSession, logoUrl, DEFAULT_LOGO } from '../session.js';
import { openFlight } from '../flightio.js';
import { config } from '../config.js';
import { downloadRawSet } from '../export/rawdl.js';

export function mountFlights(root, ctx) {
  const me = session.me || {};
  const el = html(`<main class="page">
      <section class="card">
        <div class="card-head"><h2>${esc(t('fl.saved'))}</h2><div class="row-wrap" style="gap:8px"><span class="muted small" data-summary></span><button class="btn sm primary" type="button" data-act="new">+ ${esc(t('fl.new'))}</button></div></div>
        <div class="scroll-x" data-table><p class="muted">${esc(t('fl.loading'))}</p></div>
        <span class="muted small">${esc(t('fl.hint'))}</span>
      </section>
      <div class="row-wrap" style="align-items:flex-start">
        <section class="card" style="flex:1 1 340px">
          <h2>${esc(t('fl.codeLogo'))}</h2>
          <div class="row"><span class="k2">${esc(t('start.code'))}</span><span class="val">${esc(session.code || '')}</span></div>
          <label class="f">${esc(t('start.displayName'))}<input class="in" data-pref="displayName" maxlength="60" value="${esc(me.displayName || '')}"></label>
          <label class="f">${esc(t('fl.org'))}<input class="in" data-pref="org" maxlength="60" placeholder="${esc(t('fl.orgPh'))}" value="${esc((me.prefs && me.prefs.org) || '')}"></label>
          <div class="row-wrap" style="align-items:center;gap:12px">
            <img data-logo src="${logoUrl(session.code, me.logo)}" alt="" style="height:46px;max-width:180px;object-fit:contain;background:#fff;border:1px solid var(--border);border-radius:8px;padding:4px">
            <label class="btn sm" style="cursor:pointer">${esc(t('fl.logoUpload'))}<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" class="hidden" data-logofile></label>
            <button class="btn sm ${me.logo ? '' : 'hidden'}" type="button" data-act="logoDelete">${esc(t('fl.logoDelete'))}</button>
          </div>
          <span class="muted small">${esc(t('fl.logoNote'))} ${esc(t('fl.orgNote'))}</span>
        </section>
        <section class="card" style="flex:1 1 300px">
          <h2>${esc(t('fl.defaults'))}</h2>
          <div class="g2">
            <label class="f">${esc(t('fl.defBalloon'))}<input class="in" data-pref="balloon" placeholder="HB-QWV" value="${esc((me.prefs && me.prefs.balloon) || '')}"></label>
            <label class="f">PIC<input class="in" data-pref="pic" value="${esc((me.prefs && me.prefs.pic) || '')}"></label>
          </div>
          <span class="muted small">${esc(t('fl.defNote'))}</span>
        </section>
        <section class="card" style="flex:1 1 260px">
          <h2>${esc(t('fl.session'))}</h2>
          <button class="btn sm" type="button" data-act="logout">${esc(t('fl.logout'))}</button>
          <span class="muted small">${esc(t('fl.logoutNote'))}</span>
        </section>
      </div>
  </main>`);

  const table = el.querySelector('[data-table]'), summary = el.querySelector('[data-summary]');
  let flights = [];
  const un = () => makeUnits(state.settings.units);

  async function load() {
    try {
      const [list, m] = await Promise.all([api.flights.list(), api.me.get()]);
      flights = list; setMe(m); ctx.refreshBars(); render();
    } catch (ex) {
      table.innerHTML = `<p class="err">${esc(ex instanceof ApiError && ex.status === 401 ? t('start.errUnknown') : t('start.errNetwork'))}</p>`;
    }
  }

  function render() {
    const m = session.me || {};
    summary.textContent = t('fl.summary', { n: flights.length, size: fmtBytes(m.bytes || 0), years: 2 });
    if (!flights.length) { table.innerHTML = `<p class="muted">${esc(t('fl.empty'))}</p>`; return; }
    const u = un();
    const rows = flights.map((f) => {
      const st = f.stats || {}; const route = [st.startPlace, st.landPlace].filter(Boolean).join(' → ');
      const cur = state.flight && state.flight.id === f.id;
      return `<tr class="${cur ? 'cur' : ''}"><td class="mono nowrap">${f.startTs ? fmtDateUTC(f.startTs) : '–'}</td>
        <td style="min-width:200px"><strong>${esc(f.title || '–')}</strong><br><span class="muted small">${esc((st.trackers || []).join(', '))}${st.files ? ` · ${st.files} ${esc(t('fl.files'))}` : ''} · ${fmtInt(f.points)} ${esc(t('fl.points'))}${f.rawFiles ? ` · ${esc(t('fl.rawFiles', { n: f.rawFiles }))}` : ''}</span></td>
        <td class="nowrap">${esc((f.meta && f.meta.balloon) || '–')}</td>
        <td style="min-width:160px">${esc(route || '–')}</td>
        <td class="r mono">${st.durationSec ? fmtDurationClock(st.durationSec) : '–'}</td>
        <td class="r mono">${st.distanceM ? u.dist(st.distanceM) : '–'}</td>
        <td class="nowrap"><a href="${esc(shortUrl(f.id))}" target="_blank" rel="noopener" class="mono small">/v/${esc(f.id)}</a> <button class="btn xs" type="button" data-act="copy" data-id="${f.id}" title="${esc(t('exp.copyLink'))}">⧉</button>${f.public ? '' : ` <span class="tag">${esc(t('fl.private'))}</span>`}</td>
        <td class="nowrap"><button class="btn xs primary" type="button" data-act="open" data-id="${f.id}">${esc(t('fl.open'))}</button>${f.rawFiles ? ` <button class="btn xs" type="button" data-act="raw" data-id="${f.id}" data-title="${esc(f.title || f.id)}" title="${esc(t('fl.rawTitle'))}">${esc(t('fl.rawBtn', { n: f.rawFiles }))}</button>` : ''} <button class="btn xs" type="button" data-act="del" data-id="${f.id}">${esc(t('common.remove'))}</button></td></tr>`;
    }).join('');
    table.innerHTML = `<table class="tbl flights"><thead><tr><th>${esc(t('fl.col.date'))}</th><th>${esc(t('fl.col.title'))}</th><th>${esc(t('rep.reg'))}</th><th>${esc(t('fl.col.route'))}</th><th class="r">${esc(t('st.duration'))}</th><th class="r">${esc(t('st.distance'))}</th><th>${esc(t('fl.col.viewer'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const shortUrl = (id) => `${(config.appUrl || location.origin).replace(/\/$/, '')}/v/${id}`;

  let prefTimer = null;
  el.querySelectorAll('[data-pref]').forEach((inp) => inp.addEventListener('input', () => {
    clearTimeout(prefTimer);
    prefTimer = setTimeout(async () => {
      const patch = { prefs: {} };
      el.querySelectorAll('[data-pref]').forEach((i) => { if (i.dataset.pref === 'displayName') patch.displayName = i.value.trim(); else patch.prefs[i.dataset.pref] = i.value.trim(); });
      try { setMe(await api.me.update(patch)); ctx.refreshBars(); toast(t('fl.saved1')); } catch { toast(t('start.errNetwork'), true); }
    }, 700);
  }));
  el.querySelector('[data-logofile]').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 1024 * 1024) { toast(t('fl.logoTooBig'), true); return; }
    try {
      await api.me.putLogo(f);
      setMe({ ...(session.me || {}), logo: true, logoType: f.type });
      el.querySelector('[data-logo]').src = logoUrl(session.code, true) + '?t=' + Date.now();
      el.querySelector('[data-act="logoDelete"]').classList.remove('hidden');
      ctx.refreshBars(); toast(t('fl.logoSaved'));
    } catch (ex) { toast(ex.status === 413 ? t('fl.logoTooBig') : ex.status === 415 ? t('fl.logoType') : t('start.errNetwork'), true); }
  });

  onAct(el, {
    new: () => { ctx.goto('import'); },
    raw: async (b) => {   // the imported tracker files of an own flight, as stored (0.8.8)
      b.disabled = true;
      try { const list = await api.flights.raw(b.dataset.id); if (!list.length) { toast(t('adm.rawNoFiles'), true); return; } toast(t('adm.rawLoading', { n: list.length })); await downloadRawSet({ list, fetchFile: (n) => api.flights.rawFile(b.dataset.id, n), title: b.dataset.title, id: b.dataset.id }); }
      catch (ex) { console.error(ex); toast(t('start.errNetwork'), true); } finally { b.disabled = false; }
    },
    open: async (b) => {
      const f = flights.find((x) => x.id === b.dataset.id); if (!f) return;
      if (state.track && !(state.flight && state.flight.id === f.id)) {
        const ok = await confirmDialog({ title: t('fl.open'), text: esc(t('fl.openReplace')), okLabel: t('fl.open'), cancelLabel: t('common.cancel') });
        if (!ok) return;
      }
      b.disabled = true; toast(t('fl.opening'));
      try {
        const [text, eventRows] = await Promise.all([api.flights.track(f.id), f.hasEvents ? api.flights.events(f.id).catch(() => null) : null]);
        await openFlight({ ...f, url: shortUrl(f.id) }, text, { eventRows }); ctx.refreshBars(); ctx.goto('analyze');
      }
      catch (ex) { console.error(ex); toast(t('start.errNetwork'), true); b.disabled = false; }
    },
    copy: async (b) => { if (await copyText(shortUrl(b.dataset.id))) toast(t('common.copied')); },
    del: async (b) => {
      const f = flights.find((x) => x.id === b.dataset.id); if (!f) return;
      const ok = await confirmDialog({ title: t('fl.deleteTitle'), text: tx('fl.deleteText', { title: f.title || f.id }), okLabel: t('common.remove'), cancelLabel: t('common.cancel'), danger: true });
      if (!ok) return;
      try { await api.flights.remove(f.id); if (state.flight && state.flight.id === f.id) state.flight = null; await load(); toast(t('fl.deleted')); } catch { toast(t('start.errNetwork'), true); }
    },
    logoDelete: async () => {
      try { await api.me.deleteLogo(); setMe({ ...(session.me || {}), logo: false }); el.querySelector('[data-logo]').src = DEFAULT_LOGO; el.querySelector('[data-act="logoDelete"]').classList.add('hidden'); ctx.refreshBars(); } catch { toast(t('start.errNetwork'), true); }
    },
    logout: () => { clearSession(); state.flight = null; ctx.refreshBars(); ctx.goto('start'); },
  });
  el.querySelector('[data-logo]').addEventListener('error', (e) => { e.target.src = DEFAULT_LOGO; });

  const off = bus.on('flight', render);
  load();
  root.appendChild(el);
  return { unmount: off };
}
