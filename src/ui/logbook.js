// Logbuch (0.11.0): all saved flights of the PIN as one table – year filter, totals, CSV (Excel, semicolon, BOM)
// and a printable A4 landscape page (browser print → PDF). Built from the stored Kennzahlen and Stammdaten only,
// no track is loaded. Pure helpers (rows, csv) are exported for tests.

import { t } from '../i18n.js';
import { esc, html, onAct, icons } from '../util/dom.js';
import { fmtDateUTC, fmtTimeUTC, fmtDurationClock, icaoShort } from '../util/format.js';
import { makeUnits } from '../util/units.js';
import { state } from '../state.js';
import { session, logoUrl, orgName, DEFAULT_LOGO } from '../session.js';
import { saveBlob } from '../export/download.js';

const ms = (x) => (x && x.time ? Date.parse(x.time) : NaN);
const place = (p, name) => name || (p && Number.isFinite(p.lat) ? icaoShort(p.lat, p.lon) : '');

/** One logbook row per saved flight (newest first); values already formatted for display and CSV. */
export function logbookRows(flights, units = 'icao') {
  const un = makeUnits(units);
  const rows = flights.map((f) => {
    const st = f.stats || {}, m = f.meta || {};
    const t0 = ms(st.takeoff), t1 = ms(st.landing);
    return {
      id: f.id, title: f.title || m.title || '', date: Number.isFinite(t0) ? fmtDateUTC(t0) : (f.startTs ? fmtDateUTC(f.startTs) : ''), sortMs: Number.isFinite(t0) ? t0 : (f.startTs || 0), year: new Date(Number.isFinite(t0) ? t0 : (f.startTs || 0)).getUTCFullYear(),
      takeoff: Number.isFinite(t0) ? fmtTimeUTC(t0) : '', takeoffPlace: place(st.takeoff, m.startName || st.startPlace),
      landing: Number.isFinite(t1) ? (Number.isFinite(t0) && fmtDateUTC(t1) !== fmtDateUTC(t0) ? `${fmtDateUTC(t1)} ${fmtTimeUTC(t1)}` : fmtTimeUTC(t1)) : '', landingPlace: place(st.landing, m.landName || st.landPlace),
      durationSec: st.durationSec || 0, duration: st.durationSec ? fmtDurationClock(st.durationSec) : '', nightSec: st.nightSec || 0, night: st.nightSec ? fmtDurationClock(st.nightSec) : '',
      distanceM: st.distanceM || 0, distance: st.distanceM ? un.dist(st.distanceM) : '', straight: st.straightM ? un.dist(st.straightM) : '', altMax: st.altMaxM != null ? un.alt(st.altMaxM) : '', landings: st.landings ?? '',
      balloon: [m.balloon, m.type].filter(Boolean).join(' '), pic: m.pic || '', copilot: m.copilot || '', pax: m.pax ? String(m.pax).split(/[\n,]/).map((x) => x.trim()).filter(Boolean).length : 0,
      purpose: m.purpose ? t('rep.purpose.' + m.purpose) : '', event: m.event || '', url: f.url || '',
    };
  });
  return rows.sort((a, b) => b.sortMs - a.sortMs);
}

export function logbookTotals(rows) {
  return { n: rows.length, durationSec: rows.reduce((s, r) => s + r.durationSec, 0), nightSec: rows.reduce((s, r) => s + r.nightSec, 0), distanceM: rows.reduce((s, r) => s + r.distanceM, 0), landings: rows.reduce((s, r) => s + (+r.landings || 0), 0) };
}

const COLS = ['date', 'takeoff', 'takeoffPlace', 'landing', 'landingPlace', 'duration', 'night', 'distance', 'straight', 'altMax', 'landings', 'balloon', 'pic', 'copilot', 'pax', 'purpose', 'event', 'title', 'url'];

/** CSV for Excel: UTF-8 BOM, semicolon, CRLF; one line per flight, totals line at the end. */
export function logbookCsv(rows) {
  const q = (v) => { const s = String(v ?? '').replace(/ /g, ' '); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = COLS.map((c) => t('lb.col.' + c));
  const lines = [head.join(';'), ...rows.map((r) => COLS.map((c) => q(r[c])).join(';'))];
  const tot = logbookTotals(rows), un = makeUnits(state.settings.units);
  lines.push([t('lb.total', { n: tot.n }), '', '', '', '', fmtDurationClock(tot.durationSec), fmtDurationClock(tot.nightSec), un.dist(tot.distanceM), '', '', tot.landings].map(q).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** The logbook window: year filter, table, totals, CSV and print. */
export function openLogbook(flights) {
  const all = logbookRows(flights, state.settings.units);
  const years = [...new Set(all.map((r) => r.year))].sort((a, b) => b - a);
  let year = 'all';
  const org = orgName() || t('hdr.subtitle'), who = (session.me && session.me.displayName) || session.code || '';
  const bg = html(`<div class="modal-bg logbook"><section class="modal logbook" role="dialog" aria-modal="true" aria-label="${esc(t('lb.title'))}">
    <div class="head lb-head">
      <div class="lb-brand"><img src="${esc(logoUrl(session.code, session.me && session.me.logo))}" alt="" onerror="this.onerror=null;this.src='${DEFAULT_LOGO}'"><div><h1>${esc(t('lb.title'))} · <span data-year-label></span></h1><div class="muted small">${esc(org)}${who ? ` · ${esc(who)}` : ''} · ${esc(t('lb.generated'))} ${esc(fmtDateUTC(Date.now()))}</div></div></div>
      <div class="row-wrap noprint" style="gap:8px;align-items:center">
        <select class="in sm" data-year style="width:auto"><option value="all">${esc(t('lb.allYears'))}</option>${years.map((y) => `<option value="${y}">${y}</option>`).join('')}</select>
        <button class="btn sm" type="button" data-act="csv">CSV</button><button class="btn sm primary" type="button" data-act="print">${esc(t('rep.print'))}</button>
        <button type="button" class="vx" data-act="close" title="${esc(t('vw.close'))}" aria-label="${esc(t('vw.close'))}">${icons.close}</button>
      </div>
    </div>
    <div class="lb-body" data-body></div>
    <div class="muted small lb-foot">${esc(t('lb.note'))} · analyze.wicki.aero</div>
  </section></div>`);
  const body = bg.querySelector('[data-body]'), yl = bg.querySelector('[data-year-label]');
  const un = makeUnits(state.settings.units);
  const rowsNow = () => (year === 'all' ? all : all.filter((r) => r.year === +year));
  const render = () => {
    const rows = rowsNow(), tot = logbookTotals(rows);
    yl.textContent = year === 'all' ? t('lb.allYears') : year;
    const th = (k, cls = '') => `<th class="${cls}">${esc(t('lb.col.' + k))}</th>`;
    body.innerHTML = rows.length ? `<table class="tbl lb"><thead><tr>${th('date')}${th('takeoff')}${th('takeoffPlace')}${th('landing')}${th('landingPlace')}${th('duration', 'r')}${th('night', 'r')}${th('distance', 'r')}${th('straight', 'r')}${th('altMax', 'r')}${th('landings', 'r')}${th('balloon')}${th('pic')}${th('pax', 'r')}${th('purpose')}${th('title')}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="mono nowrap">${esc(r.date)}</td><td class="mono">${esc(r.takeoff)}</td><td>${esc(r.takeoffPlace)}</td><td class="mono nowrap">${esc(r.landing)}</td><td>${esc(r.landingPlace)}</td><td class="r mono">${esc(r.duration)}</td><td class="r mono">${esc(r.night || '–')}</td><td class="r mono">${esc(r.distance)}</td><td class="r mono">${esc(r.straight)}</td><td class="r mono">${esc(r.altMax)}</td><td class="r mono">${esc(r.landings)}</td><td class="nowrap">${esc(r.balloon)}</td><td>${esc(r.pic)}${r.copilot ? ` / ${esc(r.copilot)}` : ''}</td><td class="r mono">${r.pax || '–'}</td><td>${esc(r.purpose)}</td><td class="lb-title">${esc(r.title)}${r.url ? ` <a class="small noprint" href="${esc(r.url)}" target="_blank" rel="noopener">↗</a>` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="5"><strong>${esc(t('lb.total', { n: tot.n }))}</strong></td><td class="r mono"><strong>${fmtDurationClock(tot.durationSec)}</strong></td><td class="r mono">${fmtDurationClock(tot.nightSec)}</td><td class="r mono"><strong>${esc(un.dist(tot.distanceM))}</strong></td><td></td><td></td><td class="r mono">${tot.landings}</td><td colspan="5"></td></tr></tfoot></table>` : `<p class="muted">${esc(t('lb.empty'))}</p>`;
  };
  bg.querySelector('[data-year]').addEventListener('change', (e) => { year = e.target.value; render(); });
  const close = () => { bg.remove(); document.body.classList.remove('print-logbook'); };
  onAct(bg, {
    close,
    csv: () => { const rows = rowsNow(); saveBlob(new Blob([logbookCsv(rows)], { type: 'text/csv;charset=utf-8' }), `Logbuch_${year === 'all' ? 'alle' : year}_${(session.code || 'analyze')}.csv`); },
    print: () => {
      document.body.classList.add('print-logbook');
      const st = document.createElement('style'); st.textContent = '@page{size:A4 landscape;margin:12mm}'; document.head.appendChild(st);
      const done = () => { document.body.classList.remove('print-logbook'); st.remove(); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      setTimeout(() => window.print(), 50);
    },
  });
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', function escKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escKey); } });
  render();
  document.body.appendChild(bg);
  return bg;
}
