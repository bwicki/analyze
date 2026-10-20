// Phase 2 · Bereinigen: timeline with segments, ground/air state, night, trim handles; detection results; protocol.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast } from '../util/dom.js';
import { fmtInt, fmtTimeUTC, fmtDayUTC, fmtDateUTC, fmtDateTimeUTC, fmtDurationHM, icaoShort, pad2 } from '../util/format.js';
import { state, bus, setTrim, setManualLanding, recompute, ignoreLanding, restoreLandings, saveMeta } from '../state.js';
import { reverseGeocode } from '../util/places.js';
import { mergeLine } from '../process/mergeinfo.js';
import { DETECT_DEFAULTS } from '../process/detect.js';

const W = 1180, H = 150, L = 20, R = 20;

function parseUtc(s) {
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}
const fmtUtcInput = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`; };

export function mountClean(root, ctx) {
  const el = html(`<main class="page">
    <div data-banner></div>
    <section class="card">
      <h2>${esc(t('cln.timeline'))}</h2>
      <div data-timeline></div>
      <div class="legend"><span class="pill sm"><span class="dot b"></span>${esc(t('cln.leg.air'))}</span><span class="pill sm"><span class="dot x"></span>${esc(t('cln.leg.ground'))}</span><span class="pill sm"><span class="dot g"></span>${esc(t('cln.leg.cutStart'))}</span><span class="pill sm"><span class="dot r"></span>${esc(t('cln.leg.cutEnd'))}</span><span>${esc(t('cln.leg.hint'))}</span></div>
    </section>
    <div class="g3" style="align-items:start">
      <section class="card" data-detect></section>
      <section class="card">
        <h2>${esc(t('cln.trim'))}</h2>
        <label class="f">${esc(t('cln.from'))}<input class="in mono" type="text" data-from></label>
        <label class="f">${esc(t('cln.to'))}<input class="in mono" type="text" data-to></label>
        <div class="row-wrap" style="gap:8px"><button class="btn sm" type="button" data-act="apply">${esc(t('cln.apply'))}</button><button class="btn sm" type="button" data-act="auto">${esc(t('cln.auto'))}</button></div>
        <div data-trimstats></div>
      </section>
      <section class="card" data-protocol></section>
    </div>
    <section class="card"><h2>${esc(t('cln.segments'))}</h2><div class="scroll-x" data-segtable></div></section>
  </main>`);
  const tl = el.querySelector('[data-timeline]');
  const inFrom = el.querySelector('[data-from]'), inTo = el.querySelector('[data-to]');

  onAct(el, {
    apply: () => { const a = parseUtc(inFrom.value), b = parseUtc(inTo.value); if (Number.isNaN(a) || Number.isNaN(b)) { toast(t('cln.badTime'), true); return; } setTrim(a, b, false); },
    auto: () => setTrim(0, 0, true),
    landing: () => landingDialog(),
    seg: (b) => { const s = state.segments.find((x) => x.id === +b.dataset.id); if (!s) return; s.status = b.dataset.to; recompute({ reclassify: false }); },
    redetect: () => recompute({ reclassify: false }),
    ignore: (b) => { ignoreLanding(+b.dataset.t); toast(t('ana.landingIgnored')); },
    restore: () => restoreLandings(),
  });

  /**
   * Landing by hand: in-app dialog with a map of the end of the recording (last 45 min of the track, marker
   * follows the chosen time), time (UTC) with a slider, and the landing place name (prefilled by reverse geocoding).
   */
  function landingDialog() {
    const tr = state.track, st = state.stats; if (!tr || !st) return;
    const ps = tr.points, n = ps.n;
    const tEnd = state.trim.to, tStart = Math.max(state.trim.from, tEnd - 4 * 3600000);
    let ms = st.landing ? st.landing.t : tEnd;
    const toInput = (v) => new Date(v).toISOString().slice(0, 19);
    const fromInput = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN; };
    const bg = html(`<div class="modal-bg"><section class="modal" role="dialog" aria-modal="true" style="max-width:640px">
      <div class="head"><h1>${esc(t('cln.setLanding'))}</h1></div>
      <div class="muted small">${esc(t('cln.landingDialogSub'))}</div>
      <div class="map" data-lmap style="height:240px;min-height:0;flex:none"></div>
      <label class="f">${esc(t('cln.landingTime'))}<input class="in" type="datetime-local" step="1" data-ltime value="${toInput(ms)}" min="${toInput(ps.t[0])}" max="${toInput(ps.t[n - 1])}"></label>
      <input type="range" data-lrange min="${tStart}" max="${tEnd}" step="1000" value="${ms}" style="width:100%">
      <div class="row-wrap" style="gap:8px;align-items:center"><span class="mono small" data-lpos></span><button class="btn sm" type="button" data-act="last">${esc(t('cln.lastPoint'))}</button></div>
      <label class="f">${esc(t('cln.landingPlace'))}<input class="in" data-lplace value="${esc(state.meta.landName || state.places.landing || '')}" placeholder="${esc(t('cln.landingPlacePh'))}"></label>
      <div class="foot"><button class="btn" data-act="cancel" type="button">${esc(t('common.cancel'))}</button><button class="btn primary" data-act="ok" type="button">${esc(t('cln.applyLanding'))}</button></div>
    </section></div>`);
    const timeIn = bg.querySelector('[data-ltime]'), range = bg.querySelector('[data-lrange]'), pos = bg.querySelector('[data-lpos]'), placeIn = bg.querySelector('[data-lplace]');
    let map = null, marker = null;
    const pointAt = (v) => { let i = 0; while (i < n - 1 && ps.t[i] < v) i++; let p = i; while (p > 0 && !ps.fix[p]) p--; return ps.fix[p] ? { lat: ps.lat[p], lon: ps.lon[p], t: ps.t[i] } : null; };
    let geoTimer = null;
    const update = (v, from) => {
      ms = Math.min(ps.t[n - 1], Math.max(ps.t[0], v));
      if (from !== 'time') timeIn.value = toInput(ms);
      if (from !== 'range') range.value = String(Math.min(tEnd, Math.max(tStart, ms)));
      const p = pointAt(ms);
      pos.textContent = p ? `${fmtDateTimeUTC(p.t, true)} · ${icaoShort(p.lat, p.lon)}` : '–';
      if (map && p) { marker.setLatLng([p.lat, p.lon]); if (!map.getBounds().pad(-0.1).contains([p.lat, p.lon])) map.panTo([p.lat, p.lon]); }
      // place name proposal for the chosen point (only when the field was not typed by hand)
      clearTimeout(geoTimer);
      if (p && !placeIn.dataset.typed) geoTimer = setTimeout(async () => { const name = await reverseGeocode(p.lat, p.lon, document.documentElement.lang || 'de'); if (name && !placeIn.dataset.typed) placeIn.value = name; }, 400);
    };
    timeIn.addEventListener('change', () => { const v = fromInput(timeIn.value); if (!Number.isNaN(v)) update(v, 'time'); });
    range.addEventListener('input', () => update(+range.value, 'range'));
    placeIn.addEventListener('input', () => { placeIn.dataset.typed = '1'; });
    const close = () => { if (map) { map.remove(); map = null; } bg.remove(); };
    onAct(bg, {
      cancel: close,
      last: () => update(ps.t[n - 1], 'btn'),
      ok: () => {
        setManualLanding(ms);
        const name = placeIn.value.trim();
        if (name) { state.meta.landName = name; state.places.landing = name; saveMeta(); bus.emit('places'); }
        close(); toast(t('cln.landingSet', { time: fmtDateTimeUTC(ms, true) }));
      },
    });
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    document.body.appendChild(bg);
    // map of the end of the recording (last 45 min before the chosen time + what follows)
    const Lf = globalThis.L;   // Leaflet (the module-level L here is the timeline's left margin)
    if (Lf && typeof Lf.map === 'function') {
      const mEl = bg.querySelector('[data-lmap]');
      map = Lf.map(mEl, { zoomControl: true, preferCanvas: true, attributionControl: false });
      Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      const line = []; for (let i = 0; i < n; i++) if (ps.fix[i] && ps.t[i] >= tStart) line.push([ps.lat[i], ps.lon[i]]);
      if (line.length > 1) Lf.polyline(line, { color: '#1f5fbf', weight: 3 }).addTo(map);
      const p0 = pointAt(ms) || { lat: ps.lat[n - 1], lon: ps.lon[n - 1] };
      marker = Lf.circleMarker([p0.lat, p0.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#c0392b', fillOpacity: 1 }).addTo(map);
      const tail = line.slice(-60);
      if (tail.length > 1) map.fitBounds(Lf.latLngBounds(tail), { padding: [24, 24], maxZoom: 14 }); else map.setView([p0.lat, p0.lon], 13);
      map.on('click', (e) => { // click on the track picks the nearest point in time
        let best = -1, bd = Infinity; for (let i = 0; i < n; i++) { if (!ps.fix[i] || ps.t[i] < tStart) continue; const d = (ps.lat[i] - e.latlng.lat) ** 2 + ((ps.lon[i] - e.latlng.lng) * Math.cos(ps.lat[i] * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = i; } }
        if (best >= 0) update(ps.t[best], 'map');
      });
      setTimeout(() => map && map.invalidateSize(), 80);
    }
    update(ms, 'init');
    timeIn.focus();
  }

  function render() {
    const tr = state.track, st = state.stats;
    if (!tr || !st) { tl.innerHTML = `<p class="muted">${esc(t('cln.noTrack'))}</p>`; return; }
    const ps = tr.points, t0 = ps.t[0], t1 = ps.t[ps.n - 1], span = Math.max(1, t1 - t0);
    const X = (ms) => L + (ms - t0) / span * (W - L - R);
    // segments bars with air/ground colouring (per run of equal state)
    let bars = '';
    for (const s of tr.segments) {
      let run = s.from;
      for (let i = s.from + 1; i <= s.to; i++) {
        if (i === s.to || state.states[i] !== state.states[run]) {
          const x0 = X(ps.t[run]), x1 = X(ps.t[i - 1]);
          bars += `<rect x="${x0.toFixed(1)}" y="38" width="${Math.max(1.5, x1 - x0).toFixed(1)}" height="18" rx="2" fill="${state.states[run] ? '#1f5fbf' : '#9aa7b6'}"/>`;
          run = i;
        }
      }
      bars += `<rect x="${X(ps.t[s.from]).toFixed(1)}" y="62" width="${Math.max(1.5, X(ps.t[s.to - 1]) - X(ps.t[s.from])).toFixed(1)}" height="10" rx="2" fill="#fff" stroke="#c7d0dc"/>`;
      const seg = state.segments.find((x) => x.id === s.id);
      const cx = (X(ps.t[s.from]) + X(ps.t[s.to - 1])) / 2;
      if (X(ps.t[s.to - 1]) - X(ps.t[s.from]) > 60) bars += `<text x="${cx.toFixed(1)}" y="86" text-anchor="middle" font-size="11" fill="#5b6b7f">${esc(t('cln.segLabel', { id: s.id }))} · ${esc(seg ? seg.file : '')}</text>`;
    }
    // restarts / gaps
    let marks = '';
    for (const r of st.restartList) marks += `<line x1="${X(r.t).toFixed(1)}" y1="30" x2="${X(r.t).toFixed(1)}" y2="76" stroke="#c0392b" stroke-width="2"/><text x="${X(r.t).toFixed(1)}" y="104" text-anchor="middle" font-size="11" fill="#c0392b">${esc(t('cln.restart', { sec: Math.round(r.sec) }))}</text>`;
    for (const g of tr.gaps) if (!st.restartList.some((r) => Math.abs(r.t - g.to) < 1000)) marks += `<rect x="${X(g.from).toFixed(1)}" y="38" width="${Math.max(2, X(g.to) - X(g.from)).toFixed(1)}" height="18" fill="#fff4e0" stroke="#d98c00" stroke-dasharray="3 2"/>`;
    // night bands
    let night = '';
    for (const iv of st.night.intervals) night += `<rect x="${X(iv.from).toFixed(1)}" y="24" width="${(X(iv.to) - X(iv.from)).toFixed(1)}" height="60" fill="#14202e" fill-opacity="0.06"/>`;
    // ticks: pick a step so that labels are ~90 px apart
    const hours = span / 3600000; const stepH = hours > 60 ? 6 : hours > 24 ? 3 : hours > 8 ? 1 : 0.5;
    let ticks = ''; const first = Math.ceil(t0 / (stepH * 3600000)) * stepH * 3600000;
    for (let m = first; m <= t1; m += stepH * 3600000) { const d = new Date(m); const lab = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? fmtDayUTC(m) : fmtTimeUTC(m); ticks += `<line x1="${X(m).toFixed(1)}" y1="100" x2="${X(m).toFixed(1)}" y2="106" stroke="#9aa7b6"/><text x="${X(m).toFixed(1)}" y="122" text-anchor="middle" font-size="11" fill="#5b6b7f" font-family="IBM Plex Mono, monospace">${lab}</text>`; }
    // trim handles
    const hx0 = X(state.trim.from), hx1 = X(state.trim.to);
    const handles = `<rect x="${L}" y="24" width="${Math.max(0, hx0 - L).toFixed(1)}" height="60" fill="#fff" fill-opacity="0.55"/><rect x="${hx1.toFixed(1)}" y="24" width="${Math.max(0, W - R - hx1).toFixed(1)}" height="60" fill="#fff" fill-opacity="0.55"/>
      <g class="handle" data-h="from"><line x1="${hx0.toFixed(1)}" y1="26" x2="${hx0.toFixed(1)}" y2="90" stroke="#1f8a4c" stroke-width="2.5"/><rect x="${(hx0 - 9).toFixed(1)}" y="84" width="18" height="18" rx="3" fill="#1f8a4c"/><text x="${hx0.toFixed(1)}" y="140" text-anchor="middle" font-size="12" font-weight="600" fill="#1f8a4c">${fmtTimeUTC(state.trim.from)}</text></g>
      <g class="handle" data-h="to"><line x1="${hx1.toFixed(1)}" y1="26" x2="${hx1.toFixed(1)}" y2="90" stroke="#c0392b" stroke-width="2.5"/><rect x="${(hx1 - 9).toFixed(1)}" y="84" width="18" height="18" rx="3" fill="#c0392b"/><text x="${hx1.toFixed(1)}" y="140" text-anchor="middle" font-size="12" font-weight="600" fill="#c0392b">${fmtTimeUTC(state.trim.to)}</text></g>`;
    // events
    let evs = '';
    for (const e of st.takeoff ? [st.takeoff] : []) evs += `<text x="${X(e.t).toFixed(1)}" y="20" text-anchor="middle" font-size="11" fill="#1f8a4c">${esc(t('cln.takeoffShort'))} ${fmtTimeUTC(e.t)}</text>`;
    for (const e of st.landing ? [st.landing] : []) evs += `<text x="${X(e.t).toFixed(1)}" y="20" text-anchor="middle" font-size="11" fill="#c0392b">${esc(t('cln.landingShort'))} ${fmtTimeUTC(e.t)}</text>`;
    tl.innerHTML = `<svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('cln.timeline'))}" font-family="IBM Plex Sans, sans-serif">${night}${bars}${marks}<line x1="${L}" y1="100" x2="${W - R}" y2="100" stroke="#d9dee6"/>${ticks}${evs}${handles}</svg>`;
    bindHandles(tl.querySelector('svg'), X, t0, span);
    inFrom.value = fmtUtcInput(state.trim.from); inTo.value = fmtUtcInput(state.trim.to);

    // banner
    const b = el.querySelector('[data-banner]');
    const restarts = st.restartList.length;
    b.innerHTML = `<div class="banner ${restarts ? 'info' : 'ok'}"><div class="body"><h3>${esc(restarts ? t('cln.bannerRestart', { n: restarts, sec: Math.round(st.restartList[0].sec), time: fmtDateTimeUTC(st.restartList[0].t, true) }) : t('cln.bannerClean'))}</h3><div class="sub">${esc(t('cln.bannerTrim', { before: fmtDurationHM((state.trim.from - t0) / 1000), after: fmtDurationHM((t1 - state.trim.to) / 1000) }))}</div></div></div>`;
    // detection card
    const det = el.querySelector('[data-detect]');
    const d = state.settings.detect;
    det.innerHTML = `<h2>${esc(t('cln.detect'))}</h2>
      <div class="row"><span>${esc(t('cln.takeoff'))}</span><span class="val">${st.takeoff ? fmtDateTimeUTC(st.takeoff.t, true) : '–'}</span></div>
      <div class="row"><span class="k2">${esc(t('cln.position'))}</span><span class="val small">${st.takeoff ? icaoShort(st.takeoff.lat, st.takeoff.lon) : '–'}</span></div>
      <div class="row"><span>${esc(t('cln.landing'))}</span><span class="val">${st.landing ? fmtDateTimeUTC(st.landing.t, true) : '–'}${st.landing && st.landing.manual ? ' ✎' : ''}</span></div>
      <div class="row"><span class="k2">${esc(t('cln.position'))}</span><span class="val small">${st.landing ? icaoShort(st.landing.lat, st.landing.lon) : '–'}</span></div>
      <div class="row"><span>${esc(t('cln.intermediate'))}</span><span class="val">${st.intermediate.length ? st.intermediate.map((l) => `<span class="inter">${fmtTimeUTC(l.t)} <button type="button" class="tt-x inline" data-act="ignore" data-t="${l.t}" title="${esc(t('ana.ignoreLanding'))}">×</button></span>`).join('<br>') : esc(t('cln.none'))}${state.ignoredLandings.length ? `<br><span class="sub">${esc(t('ana.ignoredCount', { n: state.ignoredLandings.length }))} · <a href="#" data-act="restore">${esc(t('ana.restoreLandings'))}</a></span>` : ''}</span></div>
      ${!st.landing ? `<div class="banner warn"><div class="body"><div class="sub">${esc(t('cln.noLanding'))}</div></div></div>` : ''}
      <div class="row-wrap" style="gap:8px"><button class="btn sm" type="button" data-act="landing">${esc(t('cln.setLanding'))}</button><button class="btn sm" type="button" data-act="redetect">${esc(t('cln.redetect'))}</button></div>
      <details class="exp"><summary>${esc(t('cln.rules'))}</summary><div>
        <div class="row"><span>${esc(t('cln.rule.window'))}</span><span class="val">${d.windowSec}${' '}s</span></div>
        <div class="row"><span>${esc(t('cln.rule.air'))}</span><span class="val">GS &gt; ${(d.gsAir / 0.514444).toFixed(1)} kt ${esc(t('common.or'))} |Vario| &gt; ${d.vsAir} m/s</span></div>
        <div class="row"><span>${esc(t('cln.rule.ground'))}</span><span class="val">GS &lt; ${(d.gsGround / 0.514444).toFixed(1)} kt ${esc(t('common.and'))} |Vario| &lt; ${d.vsGround} m/s</span></div>
        <div class="muted small">${esc(t('cln.rule.hint'))}</div></div></details>`;
    // trim stats
    const i0 = st.trim.i0, i1 = st.trim.i1;
    el.querySelector('[data-trimstats]').innerHTML = `<div class="row"><span>${esc(t('cln.removedBefore'))}</span><span class="val">${fmtInt(i0)}</span></div><div class="row"><span>${esc(t('cln.removedAfter'))}</span><span class="val">${fmtInt(ps.n - 1 - i1)}</span></div><div class="row"><span>${esc(t('cln.remaining'))}</span><span class="val">${fmtInt(i1 - i0 + 1)}</span></div>${state.trim.auto ? `<span class="muted small">${esc(t('cln.autoNote', { sec: state.settings.detect.trimReserveSec }))}</span>` : `<span class="muted small">${esc(t('cln.manualNote'))}</span>`}`;
    // protocol
    const files = state.files.length, used = state.segments.filter((s) => s.status === 'use').length, dup = state.segments.filter((s) => s.status === 'dup').length;
    const dropped = state.segments.reduce((s, x) => s + (x.status === 'use' ? x.dropped : 0), 0), bad = state.segments.reduce((s, x) => s + (x.status === 'use' ? x.bad : 0), 0);
    el.querySelector('[data-protocol]').innerHTML = `<h2>${esc(t('cln.protocol'))}</h2>
      <div class="row"><span>${esc(t('cln.p.files'))}</span><span class="val">${files} (${used} ${esc(t('cln.p.used'))})</span></div>
      <div class="row"><span>${esc(t('cln.p.dups'))}</span><span class="val">${dup}</span></div>
      <div class="row"><span>${esc(t('cln.p.badLines'))}</span><span class="val">${fmtInt(bad)}</span></div>
      <div class="row"><span>${esc(t('cln.p.dropped'))}</span><span class="val">${fmtInt(dropped)}</span></div>
      <div class="row"><span>${esc(t('cln.p.collapsed'))}</span><span class="val">${fmtInt(tr.collapsed)}</span></div>
      <div class="row"><span>${esc(t('cln.p.gaps', { sec: state.settings.gapSec }))}</span><span class="val">${tr.gaps.length}</span></div>
      <div class="row"><span>${esc(t('cln.p.restarts'))}</span><span class="val">${restarts}${restarts ? ` (${st.restartList.map((r) => Math.round(r.sec) + ' s').join(', ')})` : ''}</span></div>
      <div class="row"><span>${esc(t('cln.p.altMasked'))}</span><span class="val">${fmtInt(st.altMasked)}</span></div>
      ${mergeLine(tr) ? `<div class="row"><span>${esc(t('cln.p.devices'))}</span><span class="val" style="white-space:normal;text-align:right;font-family:var(--sans);font-size:13px">${esc(mergeLine(tr))}</span></div>` : ''}
      <span class="muted small">${esc(t('cln.p.note'))}</span>`;
    // segments table
    const rows = state.segments.map((s) => `<tr class="${s.status === 'use' ? '' : 'dim'}"><td class="mono">${s.id}</td><td class="mono">${esc(s.file)}${s.part ? ` <span class="tag">${s.part}/${s.parts}</span>` : ''}</td><td class="mono nowrap">${fmtDateUTC(s.t0)} ${fmtTimeUTC(s.t0, true)}</td><td class="mono nowrap">${fmtDateUTC(s.t1)} ${fmtTimeUTC(s.t1, true)}</td><td class="mono">${fmtDurationHM((s.t1 - s.t0) / 1000)}</td><td class="r mono">${fmtInt(s.n)}</td><td>${esc(t('imp.st.' + s.status, { id: s.dupOf || '' }))}</td><td class="r">${s.status === 'use' ? `<button class="btn xs" type="button" data-act="seg" data-id="${s.id}" data-to="off">${esc(t('imp.exclude'))}</button>` : `<button class="btn xs" type="button" data-act="seg" data-id="${s.id}" data-to="use">${esc(t('imp.use'))}</button>`}</td></tr>`).join('');
    el.querySelector('[data-segtable]').innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>${esc(t('imp.col.file'))}</th><th>${esc(t('cln.col.from'))}</th><th>${esc(t('cln.col.to'))}</th><th>${esc(t('cln.col.dur'))}</th><th class="r">${esc(t('imp.col.points'))}</th><th>${esc(t('imp.col.status'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function bindHandles(svg, X, t0, span) {
    let drag = null;
    const toMs = (clientX) => { const r = svg.getBoundingClientRect(); const x = (clientX - r.left) / r.width * W; return t0 + Math.max(0, Math.min(1, (x - L) / (W - L - R))) * span; };
    svg.addEventListener('pointerdown', (e) => { const h = e.target.closest('.handle'); if (!h) return; drag = h.dataset.h; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
    svg.addEventListener('pointermove', (e) => { if (!drag) return; const ms = toMs(e.clientX); if (drag === 'from') inFrom.value = fmtUtcInput(ms); else inTo.value = fmtUtcInput(ms); });
    svg.addEventListener('pointerup', (e) => { if (!drag) return; const ms = toMs(e.clientX); const from = drag === 'from' ? ms : state.trim.from, to = drag === 'to' ? ms : state.trim.to; drag = null; setTrim(from, to, false); });
  }

  const off = bus.on('track', render);
  render();
  root.appendChild(el);
  return { unmount: off };
}

export function cleanStatus() {
  const st = state.stats; if (!st) return esc(t('cln.noTrack'));
  return tx('cln.status', { takeoff: st.takeoff ? fmtDateTimeUTC(st.takeoff.t) : '–', landing: st.landing ? fmtDateTimeUTC(st.landing.t) : '–', dur: fmtDurationHM(st.durationSec), landings: st.landings, segs: state.track.segments.length });
}
