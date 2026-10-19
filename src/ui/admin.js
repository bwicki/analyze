// Supermaster (#admin): one-time setup (name + PIN), login, overview of Kennungen, flights and the usage log.
// Reached through the ☰ menu or directly via #admin; nothing here is linked from the user flow.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast, confirmDialog } from '../util/dom.js';
import { fmtInt, fmtBytes, fmtDateTimeUTC, fmtDateUTC } from '../util/format.js';
import { api, ApiError } from '../api.js';
import { session, setAdmin, hasServer } from '../session.js';
import { config } from '../config.js';

const start_code = () => t('start.code');

export function mountAdmin(root, ctx) {
  const el = html(`<main class="page"><div data-body></div></main>`);
  const body = el.querySelector('[data-body]');
  let tab = 'codes';

  async function start() {
    if (!hasServer()) { body.innerHTML = `<div class="banner info"><div class="body"><h3>${esc(t('start.noServer'))}</h3></div></div>`; return; }
    if (session.adminToken) {
      try { const me = await api.admin.me(); session.adminName = me.name; await dashboard(); return; } catch { setAdmin(null, null); }
    }
    let needed = false;
    try { needed = await api.admin.setupNeeded(); } catch { body.innerHTML = `<p class="err">${esc(t('start.errNetwork'))}</p>`; return; }
    loginForm(needed);
  }

  function loginForm(setup) {
    body.innerHTML = `<section class="card" style="max-width:460px">
      <h2>${esc(setup ? t('adm.setupTitle') : t('adm.loginTitle'))}</h2>
      <p class="small">${esc(setup ? t('adm.setupSub') : t('adm.loginSub'))}</p>
      <form data-form class="col" style="gap:10px">
        <label class="f">${esc(t('adm.name'))}<input class="in" data-name autocomplete="username" required></label>
        <label class="f">PIN<input class="in" data-pin type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="6"></label>
        ${setup ? `<label class="f">${esc(t('adm.pinRepeat'))}<input class="in" data-pin2 type="password" autocomplete="new-password" required minlength="6"></label>` : ''}
        <div class="err hidden" data-err></div>
        <button class="btn primary" type="submit">${esc(setup ? t('adm.setupBtn') : t('adm.loginBtn'))}</button>
      </form></section>`;
    const err = body.querySelector('[data-err]');
    body.querySelector('[data-form]').addEventListener('submit', async (e) => {
      e.preventDefault(); err.classList.add('hidden');
      const name = body.querySelector('[data-name]').value.trim(), pin = body.querySelector('[data-pin]').value;
      if (setup && pin !== body.querySelector('[data-pin2]').value) { err.textContent = t('adm.pinMismatch'); err.classList.remove('hidden'); return; }
      try {
        if (setup) await api.admin.setup(name, pin);
        const r = await api.admin.login(name, pin);
        setAdmin(r.token, r.name); await dashboard();
      } catch (ex) { err.textContent = ex instanceof ApiError ? (ex.status === 401 ? t('adm.wrong') : ex.message) : t('start.errNetwork'); err.classList.remove('hidden'); }
    });
  }

  async function dashboard() {
    body.innerHTML = `<div class="row-wrap" style="align-items:center;gap:10px">
        <div class="seg"><button type="button" data-tab="codes">${esc(t('adm.codes'))}</button><button type="button" data-tab="flights">${esc(t('adm.flights'))}</button><button type="button" data-tab="profiles">${esc(t('adm.profiles'))}</button><button type="button" data-tab="log">${esc(t('adm.log'))}</button></div>
        <span class="muted small" data-stats></span>
        <span style="margin-left:auto" class="row-wrap" style="gap:8px"><button class="btn sm" type="button" data-act="pin">${esc(t('adm.changePin'))}</button><button class="btn sm" type="button" data-act="logout">${esc(t('fl.logout'))} (${esc(session.adminName || '')})</button></span>
      </div>
      <section class="card"><div class="scroll-x" data-content><p class="muted">${esc(t('fl.loading'))}</p></div></section>`;
    body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; show(); }));
    try { const s = await api.admin.stats(); body.querySelector('[data-stats]').textContent = t('adm.statsLine', { codes: s.codes, flights: s.flights, size: fmtBytes(s.bytes), days: s.retentionDays, actions: s.actions30d }); } catch { /* ignore */ }
    show();
  }

  async function show() {
    body.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const c = body.querySelector('[data-content]');
    try {
      if (tab === 'codes') {
        const rows = await api.admin.codes();
        c.innerHTML = `<table class="tbl"><thead><tr><th>${esc(t('start.code'))}</th><th>${esc(t('start.displayName'))}</th><th class="r">${esc(t('adm.flights'))}</th><th class="r">${esc(t('adm.size'))}</th><th>${esc(t('adm.created'))}</th><th>${esc(t('adm.lastSeen'))}</th><th>Logo</th><th>${esc(t('adm.team'))}</th><th></th></tr></thead><tbody>
          ${rows.map((r) => `<tr class="${r.blocked ? 'dim' : ''}"><td class="mono">${esc(r.code)}${r.blocked ? ` <span class="tag">${esc(t('adm.blocked'))}</span>` : ''}</td><td>${esc(r.displayName || '–')}</td><td class="r mono">${r.flights}</td><td class="r mono">${fmtBytes(r.bytes)}</td><td class="mono">${fmtDateUTC(r.createdAt)}</td><td class="mono">${r.lastSeen ? fmtDateTimeUTC(r.lastSeen) : '–'}</td><td>${r.logo ? '✓' : '–'}</td><td>${r.team ? '✓' : '–'}</td>
            <td class="nowrap"><button class="btn xs" type="button" data-act="team" data-code="${r.code}" data-team="${r.team ? 1 : 0}">${esc(r.team ? t('adm.teamOff') : t('adm.teamOn'))}</button> <button class="btn xs" type="button" data-act="block" data-code="${r.code}" data-blocked="${r.blocked ? 1 : 0}">${esc(r.blocked ? t('adm.unblock') : t('adm.block'))}</button> <button class="btn xs" type="button" data-act="delCode" data-code="${r.code}">${esc(t('common.remove'))}</button></td></tr>`).join('') || `<tr><td colspan="9" class="muted">–</td></tr>`}</tbody></table><div class="muted small">${esc(t('adm.teamNote'))}</div>`;
      } else if (tab === 'flights') {
        const rows = await api.admin.flights();
        c.innerHTML = `<table class="tbl"><thead><tr><th>${esc(t('fl.col.date'))}</th><th>${esc(t('fl.col.title'))}</th><th>${esc(t('start.code'))}</th><th class="r">${esc(t('fl.points'))}</th><th class="r">${esc(t('adm.size'))}</th><th>${esc(t('adm.updated'))}</th><th>${esc(t('fl.col.viewer'))}</th><th></th></tr></thead><tbody>
          ${rows.map((f) => `<tr><td class="mono">${f.startTs ? fmtDateUTC(f.startTs) : '–'}</td><td>${esc(f.title || '–')}</td><td class="mono">${esc(f.code)}</td><td class="r mono">${fmtInt(f.points)}</td><td class="r mono">${fmtBytes(f.bytes)}</td><td class="mono">${fmtDateTimeUTC(f.updatedAt)}</td><td><a class="mono small" target="_blank" rel="noopener" href="${esc((config.appUrl || location.origin) + '/v/' + f.id)}">/v/${esc(f.id)}</a>${f.public ? '' : ` <span class="tag">${esc(t('fl.private'))}</span>`}</td><td><button class="btn xs" type="button" data-act="delFlight" data-id="${f.id}">${esc(t('common.remove'))}</button></td></tr>`).join('') || `<tr><td colspan="8" class="muted">–</td></tr>`}</tbody></table>`;
      } else if (tab === 'profiles') {
        const rows = await api.admin.profiles();
        c.innerHTML = `<table class="tbl"><thead><tr><th>ID</th><th>${esc(t('as.name'))}</th><th>${esc(t('as.manufacturer'))}</th><th>${esc(t('as.col.column'))}</th><th>${esc(start_code())}</th><th>${esc(t('adm.created'))}</th><th></th></tr></thead><tbody>
          ${rows.map((p) => `<tr><td class="mono">${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.manufacturer || '–')}</td><td class="mono small">${esc(p.spec && p.spec.read ? p.spec.read.kind + (p.spec.detect && p.spec.detect.headStartsWith ? ' · ' + p.spec.detect.headStartsWith.slice(0, 40) : '') : '–')}</td><td class="mono">${esc(p.createdBy)}</td><td class="mono">${fmtDateUTC(p.createdAt)}</td><td><button class="btn xs" type="button" data-act="delProfile" data-id="${esc(p.id)}">${esc(t('common.remove'))}</button></td></tr>`).join('') || `<tr><td colspan="7" class="muted">–</td></tr>`}</tbody></table>`;
      } else {
        const rows = await api.admin.log(300);
        c.innerHTML = `<table class="tbl"><thead><tr><th>${esc(t('adm.time'))}</th><th>${esc(t('adm.who'))}</th><th>${esc(t('adm.action'))}</th><th>${esc(t('adm.detail'))}</th><th>IP</th></tr></thead><tbody>
          ${rows.map((l) => `<tr><td class="mono nowrap">${fmtDateTimeUTC(l.t, true)}</td><td class="mono">${esc(l.who)}</td><td>${esc(l.action)}</td><td>${esc(l.detail || '')}</td><td class="mono">${esc(l.ip || '')}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">–</td></tr>`}</tbody></table>`;
      }
    } catch (ex) {
      if (ex instanceof ApiError && ex.status === 401) { setAdmin(null, null); start(); return; }
      c.innerHTML = `<p class="err">${esc(t('start.errNetwork'))}</p>`;
    }
  }

  onAct(el, {
    logout: async () => { await api.admin.logout(); setAdmin(null, null); start(); },
    block: async (b) => { try { await api.admin.block(b.dataset.code, b.dataset.blocked !== '1'); show(); } catch { toast(t('start.errNetwork'), true); } },
    team: async (b) => { try { await api.admin.team(b.dataset.code, b.dataset.team !== '1'); show(); } catch { toast(t('start.errNetwork'), true); } },
    delCode: async (b) => {
      const ok = await confirmDialog({ title: t('adm.delCodeTitle'), text: tx('adm.delCodeText', { code: b.dataset.code }), okLabel: t('common.remove'), cancelLabel: t('common.cancel'), danger: true });
      if (ok) { try { await api.admin.deleteCode(b.dataset.code); show(); } catch { toast(t('start.errNetwork'), true); } }
    },
    delProfile: async (b) => {
      const ok = await confirmDialog({ title: t('as.removeTitle'), text: esc(b.dataset.id), okLabel: t('common.remove'), cancelLabel: t('common.cancel'), danger: true });
      if (ok) { try { await api.admin.deleteProfile(b.dataset.id); show(); } catch { toast(t('start.errNetwork'), true); } }
    },
    delFlight: async (b) => {
      const ok = await confirmDialog({ title: t('fl.deleteTitle'), text: tx('fl.deleteText', { title: b.dataset.id }), okLabel: t('common.remove'), cancelLabel: t('common.cancel'), danger: true });
      if (ok) { try { await api.admin.deleteFlight(b.dataset.id); show(); } catch { toast(t('start.errNetwork'), true); } }
    },
    pin: () => {
      const bg = html(`<div class="modal-bg"><section class="modal sm" role="dialog" aria-modal="true"><div class="head"><h1>${esc(t('adm.changePin'))}</h1></div>
        <form data-pinform class="col" style="gap:10px"><label class="f">${esc(t('adm.oldPin'))}<input class="in" type="password" data-old autocomplete="current-password" required></label><label class="f">${esc(t('adm.newPin'))}<input class="in" type="password" data-new autocomplete="new-password" required minlength="6"></label>
        <div class="foot"><button class="btn" type="button" data-act="cancel">${esc(t('common.cancel'))}</button><button class="btn primary" type="submit">${esc(t('adm.changePin'))}</button></div></form></section></div>`);
      onAct(bg, { cancel: () => bg.remove() });
      bg.querySelector('[data-pinform]').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api.admin.changePin(bg.querySelector('[data-old]').value, bg.querySelector('[data-new]').value); toast(t('adm.pinChanged')); bg.remove(); }
        catch (ex) { toast(ex instanceof ApiError ? (ex.status === 401 ? t('adm.wrong') : ex.message) : t('start.errNetwork'), true); }
      });
      document.body.appendChild(bg); bg.querySelector('[data-old]').focus();
    },
  });
  start();
  root.appendChild(el);
  return { unmount: () => {} };
}
