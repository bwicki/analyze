// Ereignislog card (phase 3 · Auswerten): link the log of a flight from gb_flight_data (via the Worker),
// upload the app's JSON/CSV export, show the events as a table and hand them to map and profile.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast } from '../util/dom.js';
import { fmtTimeUTC, fmtDayUTC, fmtDateUTC, fmtDateTimeUTC, fmtInt, icaoShort, fmtLocalByLon } from '../util/format.js';
import { state, bus, setEventLog } from '../state.js';
import { api, ApiError } from '../api.js';
import { session, hasServer } from '../session.js';
import { normalizeEvents, parseEventLog, summarizeEvents, scoreFlightMatch, EVENT_TYPES, EVENT_COLORS } from '../events/log.js';

export const typeLabel = (ty) => t(`ev.type.${ty}`);

/** Events for map and profile: those inside the trim with a position. */
export function eventsForDisplay() {
  const lg = state.evlog; if (!lg || !lg.linked) return [];
  return lg.linked.filter((e) => e.inTrim && !Number.isNaN(e.lat)).map((e) => ({ t: e.t, lat: e.lat, lon: e.lon, alt: e.alt, dist: e.dist, color: EVENT_COLORS[e.type], label: `${fmtTimeUTC(e.t)} UTC · ${typeLabel(e.type)}${e.text ? ' · ' + e.text.slice(0, 80) : ''}`, type: e.type, id: e.id }));
}

/** o: {onSelect(event|null)} – mounts into container, returns {unmount}. */
export function mountEventsCard(container, o = {}) {
  const el = html(`<section class="card" data-events>
    <div class="card-head"><h2>${esc(t('ana.events'))} <span class="pill sm" data-count></span></h2>
      <div class="row-wrap noprint" style="gap:8px;align-items:center" data-tools></div></div>
    <div data-filter class="row-wrap noprint" style="gap:6px"></div>
    <div data-body></div>
  </section>`);
  const tools = el.querySelector('[data-tools]'), body = el.querySelector('[data-body]'), count = el.querySelector('[data-count]'), filterEl = el.querySelector('[data-filter]');
  const hidden = new Set();
  const fileIn = html(`<input type="file" accept=".json,.csv,.txt" class="hidden">`);
  el.appendChild(fileIn);
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    try {
      const text = await f.text();
      const s = text.trim(); let rows;
      if (s.startsWith('[') || s.startsWith('{')) { const j = JSON.parse(s); rows = Array.isArray(j) ? j : j.rows || j.events || []; }
      else rows = null;
      const events = parseEventLog(text, f.name);
      setEventLog({ source: { kind: 'file', name: f.name, flight: events[0].flight || '' }, rows: rows || events.map((e) => e.raw), events });
      toast(t('ev.loaded', { n: events.length }));
    } catch (ex) { console.error(ex); toast(t('ev.badFile'), true); }
  });

  function renderTools() {
    const v = !!state.viewer, lg = state.evlog;
    tools.innerHTML = v ? '' : [
      hasServer() && session.code ? `<button class="btn chip" type="button" data-act="repo">${esc(t('ev.fromRepo'))}</button>` : '',
      `<button class="btn chip" type="button" data-act="file">${esc(t('ev.fromFile'))}</button>`,
      lg ? `<button class="btn chip" type="button" data-act="clear">${esc(t('common.remove'))}</button>` : '',
    ].join('');
  }

  function render() {
    renderTools();
    const lg = state.evlog;
    if (!lg) {
      count.textContent = '0';
      filterEl.innerHTML = '';
      body.innerHTML = `<p class="muted small">${esc(state.viewer ? t('ev.noneViewer') : t('ev.hint'))}</p>`;
      return;
    }
    const sm = summarizeEvents(lg.events);
    const linked = lg.linked || [];
    const inTrim = linked.filter((e) => e.inTrim).length;
    count.textContent = t('ev.linkedCount', { n: inTrim, total: lg.events.length });
    filterEl.innerHTML = EVENT_TYPES.filter((ty) => sm.counts[ty]).map((ty) => `<button type="button" class="pill sm fchip ${hidden.has(ty) ? 'off' : ''}" data-act="toggle" data-type="${ty}"><span class="dot" style="background:${EVENT_COLORS[ty]}"></span>${esc(typeLabel(ty))} ${sm.counts[ty]}</button>`).join('');
    const srcLine = lg.source.kind === 'repo' ? t('ev.srcRepo', { flight: lg.source.flight }) : lg.source.kind === 'saved' ? t('ev.srcSaved', { name: lg.source.name || '–' }) : t('ev.srcFile', { name: lg.source.name });
    const ballast = sm.ballastStart !== null ? ` · ${t('ev.ballast', { from: fmtInt(sm.ballastStart), to: fmtInt(sm.ballastEnd), drops: sm.drops })}` : '';
    const rows = linked.filter((e) => !hidden.has(e.type)).map((e) => {
      const dim = !e.inTrim ? 'dim' : '';
      const pos = !Number.isNaN(e.lat) ? icaoShort(e.lat, e.lon) : '–';
      const delta = !Number.isNaN(e.distM) ? (e.distM > 2000 ? `<span class="err">${fmtInt(e.distM / 1000)} km</span>` : `${fmtInt(e.distM)} m`) : (e.onTrack ? '' : `<span class="muted">${esc(t('ev.offTrack'))}</span>`);
      return `<tr class="${dim}" data-id="${esc(e.id)}" ${!Number.isNaN(e.lat) ? 'data-sel' : ''}><td class="mono nowrap">${fmtDayUTC(e.t)} ${fmtTimeUTC(e.t)}</td><td class="nowrap"><span class="tag ev" style="--c:${EVENT_COLORS[e.type]}">${esc(typeLabel(e.type))}</span></td><td>${esc(e.place || '')}</td><td class="mono nowrap">${pos}</td><td>${esc(e.text)}${e.reporter ? ` <span class="muted small">· ${esc(e.reporter)}</span>` : ''}</td><td class="r small nowrap">${delta}</td></tr>`;
    }).join('');
    body.innerHTML = `<div class="muted small">${esc(srcLine)}${esc(ballast)} · ${esc(t('ev.deltaNote'))}</div>
      <div class="scroll-x"><table class="tbl events"><thead><tr><th>${esc(t('ev.col.time'))}</th><th>${esc(t('ev.col.type'))}</th><th>${esc(t('ev.col.place'))}</th><th>${esc(t('ev.col.pos'))}</th><th>${esc(t('ev.col.text'))}</th><th class="r">Δ</th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="muted">–</td></tr>`}</tbody></table></div>`;
    body.querySelectorAll('tr[data-sel]').forEach((tr) => {
      tr.addEventListener('mouseenter', () => { const e = linked.find((x) => x.id === tr.dataset.id); o.onSelect && o.onSelect(e || null); });
      tr.addEventListener('mouseleave', () => o.onSelect && o.onSelect(null));
    });
  }

  async function pickFromRepo() {
    const st = state.stats;
    let list;
    try { list = await api.events.repoFlights(); }
    catch (ex) { toast(ex instanceof ApiError && ex.status === 503 ? t('ev.notConfigured') : ex instanceof ApiError && ex.status === 502 ? t('ev.githubError') : t('start.errNetwork'), true); return; }
    const t0 = st ? st.trim.from : 0, t1 = st ? st.trim.to : 0;
    const scored = list.map((f) => ({ ...f, score: st ? scoreFlightMatch(f, t0, t1) : 0 })).sort((a, b) => b.score - a.score || String(b.first || '').localeCompare(String(a.first || '')));
    const bg = html(`<div class="modal-bg"><section class="modal" role="dialog" aria-modal="true" style="max-width:720px">
      <div class="head"><h1>${esc(t('ev.pickTitle'))}</h1></div>
      <p class="small">${esc(t('ev.pickSub'))}</p>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>${esc(t('ev.col.flight'))}</th><th>${esc(t('rep.reg'))}</th><th>${esc(t('ev.col.span'))}</th><th class="r">${esc(t('ev.col.rows'))}</th><th>${esc(t('ev.col.match'))}</th><th></th></tr></thead><tbody>
        ${scored.map((f) => `<tr><td><strong>${esc(f.flight)}</strong></td><td>${esc(f.callsign || '–')}</td><td class="mono small nowrap">${f.first ? fmtDateTimeUTC(Date.parse(f.first)) : '–'} – ${f.last ? fmtDateTimeUTC(Date.parse(f.last)) : '–'}</td><td class="r mono">${f.rows}</td><td>${f.score > 0.5 ? `<span class="tag" style="background:var(--ok-bg);color:var(--ok-text)">${esc(t('ev.matchGood'))}</span>` : f.score > 0 ? `<span class="tag">${esc(t('ev.matchPart'))}</span>` : '<span class="muted">–</span>'}</td><td><button class="btn xs primary" type="button" data-act="pick" data-flight="${esc(f.flight)}">${esc(t('ev.link'))}</button></td></tr>`).join('') || `<tr><td colspan="6" class="muted">${esc(t('ev.noFlights'))}</td></tr>`}
      </tbody></table></div>
      <div class="foot"><button class="btn" type="button" data-act="cancel">${esc(t('common.cancel'))}</button></div></section></div>`);
    onAct(bg, {
      cancel: () => bg.remove(),
      pick: async (b) => {
        b.disabled = true;
        try {
          const r = await api.events.repoFlight(b.dataset.flight);
          const events = normalizeEvents(r.rows);
          if (!events.length) { toast(t('ev.badFile'), true); b.disabled = false; return; }
          setEventLog({ source: { kind: 'repo', flight: r.flight, name: `gb_flight_data/${r.flight}`, fetchedAt: r.fetchedAt }, rows: r.rows, events });
          toast(t('ev.loaded', { n: events.length })); bg.remove();
        } catch (ex) { console.error(ex); toast(t('start.errNetwork'), true); b.disabled = false; }
      },
    });
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);
  }

  onAct(el, {
    repo: pickFromRepo,
    file: () => fileIn.click(),
    clear: () => { setEventLog(null); },
    toggle: (b) => { const ty = b.dataset.type; if (hidden.has(ty)) hidden.delete(ty); else hidden.add(ty); render(); bus.emit('events-filter', [...hidden]); },
  });
  const off1 = bus.on('events', render), off2 = bus.on('track', render);
  render();
  container.appendChild(el);
  return { unmount: () => { off1(); off2(); }, hidden };
}
