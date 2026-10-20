// Phase 2 · Bereinigen: timeline with segments, ground/air state, night, trim handles; detection results; protocol.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast } from '../util/dom.js';
import { fmtInt, fmtTimeUTC, fmtDayUTC, fmtDateUTC, fmtDateTimeUTC, fmtDurationHM, icaoShort, pad2 } from '../util/format.js';
import { state, bus, setTrim, setManualLanding, recompute, ignoreLanding, restoreLandings, saveMeta } from '../state.js';
import { reverseGeocode } from '../util/places.js';
import { mergeLine } from '../process/mergeinfo.js';
import { DETECT_DEFAULTS } from '../process/detect.js';
import { makeUnits } from '../util/units.js';
import { terrainForDisplay } from '../terrain/store.js';
import { openViewer, fitBox, expandBtn } from './viewer.js';

// timeline geometry (SVG units): state bar, segment bar, altitude mini-profile, axis, handle labels
const W = 1180, H = 200, L = 48, R = 20;
const SB0 = 24, SB1 = 38;          // state bar (air / ground)
const SG0 = 41, SG1 = 47;          // segment bar
const PT = 54, PB = 154;           // altitude mini-profile
const AX = 170, HL = 188;          // axis labels, handle grips (time)

function parseUtc(s) {
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}
const fmtUtcInput = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`; };

const NUDGES = [-600, -60, -10, 10, 60, 600];
const nudgeLabel = (sec) => `${sec < 0 ? '−' : '+'}${Math.abs(sec) >= 60 ? `${Math.abs(sec) / 60} min` : `${Math.abs(sec)} s`}`;
const nudgeButtons = (which) => NUDGES.map((sec) => `<button class="btn xs" type="button" data-act="nudge" data-w="${which}" data-s="${sec}" title="${esc(t(sec < 0 ? 'cln.nudgeEarlier' : 'cln.nudgeLater'))}">${nudgeLabel(sec)}</button>`).join('');

export function mountClean(root, ctx) {
  const el = html(`<main class="page">
    <div data-banner></div>
    <section class="card">
      <h2>${esc(t('cln.timeline'))}</h2>
      <div class="gfx" data-gfx="timeline"><div data-timeline></div>${expandBtn('data-what="timeline"')}</div>
      <div class="legend"><span class="pill sm"><span class="dot b"></span>${esc(t('cln.leg.air'))}</span><span class="pill sm"><span class="dot x"></span>${esc(t('cln.leg.ground'))}</span><span class="pill sm"><span class="dot g"></span>${esc(t('cln.leg.cutStart'))}</span><span class="pill sm"><span class="dot r"></span>${esc(t('cln.leg.cutEnd'))}</span><span class="pill sm"><span class="dot alt"></span>${esc(t('cln.leg.alt'))}</span><span>${esc(t('cln.leg.hint'))} ${esc(t('vw.graphicHint'))}</span></div>
    </section>
    <div class="g3" style="align-items:start">
      <section class="card" data-detect></section>
      <section class="card">
        <h2>${esc(t('cln.trim'))}</h2>
        <label class="f">${esc(t('cln.from'))}<input class="in mono" type="text" data-from></label>
        <div class="nudge" data-nudge="from">${nudgeButtons('from')}</div>
        <label class="f">${esc(t('cln.to'))}<input class="in mono" type="text" data-to></label>
        <div class="nudge" data-nudge="to">${nudgeButtons('to')}</div>
        <div class="row-wrap" style="gap:8px"><button class="btn sm" type="button" data-act="apply">${esc(t('cln.apply'))}</button><button class="btn sm" type="button" data-act="auto">${esc(t('cln.auto'))}</button></div>
        <div data-trimstats></div>
      </section>
      <section class="card" data-protocol></section>
    </div>
    <section class="card"><h2>${esc(t('cln.segments'))}</h2><div class="scroll-x" data-segtable></div></section>
  </main>`);
  const tl = el.querySelector('[data-timeline]');
  const inFrom = el.querySelector('[data-from]'), inTo = el.querySelector('[data-to]');
  let bigTl = null;   // the timeline in the viewer while open (0.9.1): {box}
  /** Timeline large in the viewer – the same SVG with working handles; both copies follow every change. */
  function openTimeline() {
    if (!state.track || bigTl) return;
    const v = openViewer({ title: esc(t('cln.timeline')), sub: cleanStatus().replace(/<[^>]+>/g, '') });   // tx() output is escaped already
    bigTl = { box: fitBox(v, W / H) };
    v.onClose(() => { bigTl = null; });
    render();
  }
  el.querySelector('[data-gfx="timeline"]').addEventListener('dblclick', (e) => { if (!e.target.closest('button, .handle')) openTimeline(); });

  onAct(el, {
    apply: () => { const a = parseUtc(inFrom.value), b = parseUtc(inTo.value); if (Number.isNaN(a) || Number.isNaN(b)) { toast(t('cln.badTime'), true); return; } setTrim(a, b, false); },
    auto: () => setTrim(0, 0, true),
    nudge: (b) => { if (!state.trim) return; const d = +b.dataset.s * 1000; if (b.dataset.w === 'from') setTrim(state.trim.from + d, state.trim.to, false); else setTrim(state.trim.from, state.trim.to + d, false); },
    landing: () => landingDialog(),
    seg: (b) => { const s = state.segments.find((x) => x.id === +b.dataset.id); if (!s) return; s.status = b.dataset.to; recompute({ reclassify: false }); },
    redetect: () => recompute({ reclassify: false }),
    ignore: (b) => { ignoreLanding(+b.dataset.t); toast(t('ana.landingIgnored')); },
    restore: () => restoreLandings(),
    expand: () => openTimeline(),
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
        if (name) { const p = pointAt(ms); state.meta.landName = name; state.places.landing = name; if (p) (state.places.at || (state.places.at = {})).landing = { lat: p.lat, lon: p.lon }; saveMeta(); bus.emit('places'); }
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
    // state bar: runs of equal air/ground state per segment; thin segment bar below
    let bars = '', seglabels = '';
    for (const s of tr.segments) {
      let run = s.from;
      for (let i = s.from + 1; i <= s.to; i++) {
        if (i === s.to || state.states[i] !== state.states[run]) {
          const x0 = X(ps.t[run]), x1 = X(ps.t[i - 1]);
          bars += `<rect x="${x0.toFixed(1)}" y="${SB0}" width="${Math.max(1.5, x1 - x0).toFixed(1)}" height="${SB1 - SB0}" rx="2" fill="${state.states[run] ? '#1f5fbf' : '#9aa7b6'}"/>`;
          run = i;
        }
      }
      const sx0 = X(ps.t[s.from]), sx1 = X(ps.t[s.to - 1]);
      bars += `<rect x="${sx0.toFixed(1)}" y="${SG0}" width="${Math.max(1.5, sx1 - sx0).toFixed(1)}" height="${SG1 - SG0}" rx="1.5" fill="#fff" stroke="#c7d0dc"/>`;
      const seg = state.segments.find((x) => x.id === s.id);
      if (sx1 - sx0 > 60) seglabels += `<text x="${((sx0 + sx1) / 2).toFixed(1)}" y="${PT + 11}" text-anchor="middle" font-size="10" fill="#5b6b7f" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(t('cln.segLabel', { id: s.id }))} · ${esc(seg ? seg.file : '')}</text>`;
    }
    // altitude mini-profile over the whole recording (so points before the start / after the landing show)
    const profile = miniProfile(tr, X);
    // restarts / gaps
    let marks = '';
    for (const r of st.restartList) marks += `<line x1="${X(r.t).toFixed(1)}" y1="${SB0 - 2}" x2="${X(r.t).toFixed(1)}" y2="${PB}" stroke="#c0392b" stroke-width="1.5"/><text x="${(X(r.t) + 4).toFixed(1)}" y="${PB - 4}" font-size="10" fill="#c0392b" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(t('cln.restart', { sec: Math.round(r.sec) }))}</text>`;
    for (const g of tr.gaps) if (!st.restartList.some((r) => Math.abs(r.t - g.to) < 1000)) marks += `<rect x="${X(g.from).toFixed(1)}" y="${SB0}" width="${Math.max(2, X(g.to) - X(g.from)).toFixed(1)}" height="${SB1 - SB0}" fill="#fff4e0" stroke="#d98c00" stroke-dasharray="3 2"/>`;
    // night bands
    let night = '';
    for (const iv of st.night.intervals) night += `<rect x="${X(iv.from).toFixed(1)}" y="${SB0 - 2}" width="${(X(iv.to) - X(iv.from)).toFixed(1)}" height="${PB - SB0 + 2}" fill="#14202e" fill-opacity="0.06"/>`;
    // ticks: pick a step so that labels are ~90 px apart
    const hours = span / 3600000; const stepH = hours > 60 ? 6 : hours > 24 ? 3 : hours > 8 ? 1 : hours > 3 ? 0.5 : 0.25;
    let ticks = ''; const first = Math.ceil(t0 / (stepH * 3600000)) * stepH * 3600000;
    for (let m = first; m <= t1; m += stepH * 3600000) { const d = new Date(m); const lab = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? fmtDayUTC(m) : fmtTimeUTC(m); ticks += `<line x1="${X(m).toFixed(1)}" y1="${PB}" x2="${X(m).toFixed(1)}" y2="${PB + 5}" stroke="#9aa7b6"/><line x1="${X(m).toFixed(1)}" y1="${PT}" x2="${X(m).toFixed(1)}" y2="${PB}" stroke="#e3e8ee"/><text x="${X(m).toFixed(1)}" y="${AX}" text-anchor="middle" font-size="11" fill="#5b6b7f" font-family="IBM Plex Mono, monospace">${lab}</text>`; }
    // trim: shaded cut-off ranges + slim handles (flag on top, line through the whole strip, time below)
    const hx0 = X(state.trim.from), hx1 = X(state.trim.to);
    const handle = (which, x, color, ms) => `<g class="handle" data-h="${which}" tabindex="0" role="slider" aria-label="${esc(t(which === 'from' ? 'cln.from' : 'cln.to'))}" aria-valuetext="${fmtTimeUTC(ms, true)}" transform="translate(${x.toFixed(1)},0)">
        <rect x="-8" y="${SB0 - 10}" width="16" height="${PB + 4 - SB0 + 10}" fill="transparent"/>
        <line x1="0" y1="${SB0 - 2}" x2="0" y2="${PB + 4}" stroke="${color}" stroke-width="1.5"/>
        <path d="M-4 ${SB0 - 9}h8l-4 6z" fill="${color}"/>
        <rect x="-23" y="${HL - 12}" width="46" height="17" rx="4" fill="${color}"/>
        <text y="${HL}" text-anchor="middle" font-size="11" font-weight="600" fill="#fff" font-family="IBM Plex Mono, monospace" data-hl>${fmtTimeUTC(ms)}</text></g>`;
    const handles = `<rect data-cut="from" x="${L}" y="${SB0 - 2}" width="${Math.max(0, hx0 - L).toFixed(1)}" height="${PB - SB0 + 2}" fill="#fff" fill-opacity="0.6"/><rect data-cut="to" x="${hx1.toFixed(1)}" y="${SB0 - 2}" width="${Math.max(0, W - R - hx1).toFixed(1)}" height="${PB - SB0 + 2}" fill="#fff" fill-opacity="0.6"/>
      ${handle('from', hx0, '#1f8a4c', state.trim.from)}${handle('to', hx1, '#c0392b', state.trim.to)}`;
    // events
    let evs = '';
    const anchor = (x) => (x < L + 50 ? 'start' : x > W - R - 50 ? 'end' : 'middle');   // labels near the edges stay inside
    for (const e of st.takeoff ? [st.takeoff] : []) evs += `<text x="${X(e.t).toFixed(1)}" y="13" text-anchor="${anchor(X(e.t))}" font-size="11" fill="#1f8a4c">${esc(t('cln.takeoffShort'))} ${fmtTimeUTC(e.t)}${e.cut ? ' ✂' : ''}</text>`;
    for (const e of st.landing ? [st.landing] : []) evs += `<text x="${X(e.t).toFixed(1)}" y="13" text-anchor="${anchor(X(e.t))}" font-size="11" fill="#c0392b">${esc(t('cln.landingShort'))} ${fmtTimeUTC(e.t)}${e.manual ? ' ✎' : e.cut ? ' ✂' : ''}</text>`;
    const svgHtml = `<svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('cln.timeline'))}" font-family="IBM Plex Sans, sans-serif">${night}${profile}${bars}${seglabels}${marks}<line x1="${L}" y1="${PB}" x2="${W - R}" y2="${PB}" stroke="#d9dee6"/>${ticks}${evs}${handles}</svg>`;
    const mount = (c) => { c.innerHTML = svgHtml; bindHandles(c.querySelector('svg'), X, t0, span, c); };
    mount(tl); if (bigTl) mount(bigTl.box);
    inFrom.value = fmtUtcInput(state.trim.from); inTo.value = fmtUtcInput(state.trim.to);

    // banner
    const b = el.querySelector('[data-banner]');
    const restarts = st.restartList.length;
    b.innerHTML = `<div class="banner ${restarts ? 'info' : 'ok'}"><div class="body"><h3>${esc(restarts ? t('cln.bannerRestart', { n: restarts, sec: Math.round(st.restartList[0].sec), time: fmtDateTimeUTC(st.restartList[0].t, true) }) : t('cln.bannerClean'))}</h3><div class="sub">${esc(t('cln.bannerTrim', { before: fmtDurationHM((state.trim.from - t0) / 1000), after: fmtDurationHM((t1 - state.trim.to) / 1000) }))}</div></div></div>`;
    // detection card
    const det = el.querySelector('[data-detect]');
    const d = state.settings.detect;
    det.innerHTML = `<h2>${esc(t('cln.detect'))}</h2>
      <div class="row"><span>${esc(t('cln.takeoff'))}</span><span class="val">${st.takeoff ? fmtDateTimeUTC(st.takeoff.t, true) : '–'}${st.takeoff && st.takeoff.cut ? ' ✂' : ''}</span></div>
      <div class="row"><span class="k2">${esc(t('cln.position'))}</span><span class="val small">${st.takeoff ? icaoShort(st.takeoff.lat, st.takeoff.lon) : '–'}</span></div>
      <div class="row"><span>${esc(t('cln.landing'))}</span><span class="val">${st.landing ? fmtDateTimeUTC(st.landing.t, true) : '–'}${st.landing && st.landing.manual ? ' ✎' : st.landing && st.landing.cut ? ' ✂' : ''}</span></div>
      <div class="row"><span class="k2">${esc(t('cln.position'))}</span><span class="val small">${st.landing ? icaoShort(st.landing.lat, st.landing.lon) : '–'}</span></div>
      <div class="row"><span>${esc(t('cln.intermediate'))}</span><span class="val">${st.intermediate.length ? st.intermediate.map((l) => `<span class="inter">${fmtTimeUTC(l.t)} <button type="button" class="tt-x inline" data-act="ignore" data-t="${l.t}" title="${esc(t('ana.ignoreLanding'))}">×</button></span>`).join('<br>') : esc(t('cln.none'))}${state.ignoredLandings.length ? `<br><span class="sub">${esc(t('ana.ignoredCount', { n: state.ignoredLandings.length }))} · <a href="#" data-act="restore">${esc(t('ana.restoreLandings'))}</a></span>` : ''}</span></div>
      ${(st.takeoff && st.takeoff.cut) || (st.landing && st.landing.cut) ? `<div class="muted small">${esc(t('cln.cutNote'))}</div>` : ''}
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

  function bindHandles(svg, X, t0, span, container = tl) {
    let drag = null;
    const toMs = (clientX) => { const r = svg.getBoundingClientRect(); const x = (clientX - r.left) / r.width * W; return t0 + Math.max(0, Math.min(1, (x - L) / (W - L - R))) * span; };
    // live preview while dragging: move the handle group and the shaded cut-off range, update its label
    const preview = (which, ms) => {
      const g = svg.querySelector(`.handle[data-h="${which}"]`), cut = svg.querySelector(`[data-cut="${which}"]`), x = X(ms);
      g.setAttribute('transform', `translate(${x.toFixed(1)},0)`); g.querySelector('[data-hl]').textContent = fmtTimeUTC(ms);
      if (which === 'from') cut.setAttribute('width', Math.max(0, x - L).toFixed(1)); else { cut.setAttribute('x', x.toFixed(1)); cut.setAttribute('width', Math.max(0, W - R - x).toFixed(1)); }
      if (which === 'from') inFrom.value = fmtUtcInput(ms); else inTo.value = fmtUtcInput(ms);
    };
    svg.addEventListener('pointerdown', (e) => { const h = e.target.closest('.handle'); if (!h) return; drag = h.dataset.h; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
    svg.addEventListener('pointermove', (e) => { if (!drag) return; preview(drag, toMs(e.clientX)); });
    svg.addEventListener('pointerup', (e) => { if (!drag) return; const ms = toMs(e.clientX); const from = drag === 'from' ? ms : state.trim.from, to = drag === 'to' ? ms : state.trim.to; drag = null; setTrim(from, to, false); });
    svg.addEventListener('pointercancel', () => { if (drag) { drag = null; render(); } });
    // keyboard: ← → 10 s, Shift 1 min, Alt/Ctrl 10 min
    svg.addEventListener('keydown', (e) => {
      const h = e.target.closest && e.target.closest('.handle'); if (!h || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault(); const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.altKey || e.ctrlKey ? 600 : e.shiftKey ? 60 : 10) * 1000;
      if (h.dataset.h === 'from') setTrim(state.trim.from + d, state.trim.to, false); else setTrim(state.trim.from, state.trim.to + d, false);
      setTimeout(() => { const g = container.querySelector(`.handle[data-h="${h.dataset.h}"]`); if (g) g.focus(); }, 0);
    });
  }

  /** Altitude mini-profile (whole recording, terrain + water when loaded) as SVG for the timeline strip. */
  function miniProfile(tr, X) {
    const se = state.series; if (!se) return '';
    const ps = tr.points, n = ps.n, un = makeUnits(state.settings.units);
    const terr = terrainForDisplay('time');
    let aMin = Infinity, aMax = -Infinity;
    for (let i = 0; i < n; i++) { const a = se.altClean[i]; if (Number.isNaN(a)) continue; if (a < aMin) aMin = a; if (a > aMax) aMax = a; }
    for (const p of terr) { if (p.alt < aMin) aMin = p.alt; if (p.alt > aMax) aMax = p.alt; }
    if (!Number.isFinite(aMin)) return '';
    if (aMax - aMin < 50) aMax = aMin + 50;
    const Y = (a) => PB - (a - aMin) / (aMax - aMin) * (PB - PT - 14);
    // per-pixel-column min/max of the altitude → band polygon (noisy data stays visible) + mean line
    const cols = Math.round(W - L - R), lo = new Float32Array(cols).fill(NaN), hi = new Float32Array(cols).fill(NaN);
    for (let i = 0; i < n; i++) { const a = se.altClean[i]; if (Number.isNaN(a)) continue; const c = Math.min(cols - 1, Math.max(0, Math.floor(X(ps.t[i]) - L))); if (Number.isNaN(lo[c]) || a < lo[c]) lo[c] = a; if (Number.isNaN(hi[c]) || a > hi[c]) hi[c] = a; }
    let out = '';
    // terrain (ground grey, water blue) as filled areas down to the axis
    if (terr.length) {
      let g = '', w = ''; let open = false;
      for (let k = 0; k < terr.length; k++) { const p = terr[k]; const x = X(p.x).toFixed(1), y = Y(p.alt).toFixed(1); g += (open ? 'L' : `M${x} ${PB}L`) + `${x} ${y}`; open = true; if (k === terr.length - 1) g += `L${x} ${PB}Z`; }
      out += `<path d="${g}" fill="#cfd6de" fill-opacity="0.8"/>`;
      // water stretches: rect from surface down to the axis per run of water samples
      let run = null;
      for (let k = 0; k <= terr.length; k++) { const p = terr[k]; if (p && p.water) { if (!run) run = { x0: X(p.x), y: Y(p.alt) }; run.x1 = X(p.x); } else if (run) { w += `<rect x="${run.x0.toFixed(1)}" y="${run.y.toFixed(1)}" width="${Math.max(1.5, run.x1 - run.x0).toFixed(1)}" height="${Math.max(0, PB - run.y).toFixed(1)}" fill="#8fbdeb" fill-opacity="0.85"/>`; run = null; } }
      out += w;
    }
    // altitude band + line (gaps where the altitude is masked / missing)
    let band = '', line = '', openB = false, openL = false, rev = [];
    for (let c = 0; c <= cols; c++) {
      const has = c < cols && !Number.isNaN(lo[c]);
      if (has) { const x = (L + c + 0.5).toFixed(1); band += (openB ? 'L' : 'M') + `${x} ${Y(hi[c]).toFixed(1)}`; rev.push(`${x} ${Y(lo[c]).toFixed(1)}`); line += (openL ? 'L' : 'M') + `${x} ${Y((lo[c] + hi[c]) / 2).toFixed(1)}`; openB = openL = true; }
      else if (openB) { band += 'L' + rev.reverse().join('L') + 'Z'; rev = []; openB = openL = false; }
    }
    out += `<path d="${band}" fill="#1f5fbf" fill-opacity="0.18"/><path d="${line}" fill="none" stroke="#1f5fbf" stroke-width="1.2"/>`;
    // axis: top / bottom altitude labels
    out += `<text x="${L - 6}" y="${(PT + 14 + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#5b6b7f" font-family="IBM Plex Mono, monospace">${fmtInt(un.altValue(aMax))}</text><text x="${L - 6}" y="${PB}" text-anchor="end" font-size="10" fill="#5b6b7f" font-family="IBM Plex Mono, monospace">${fmtInt(un.altValue(aMin))} ${un.altUnit}</text>`;
    return out;
  }

  const off = bus.on('track', render);
  let terrTimer = null; const off2 = bus.on('terrain', () => { if (state.terrain && (state.terrain.status === 'ready' || state.terrain.status === 'ground')) { clearTimeout(terrTimer); terrTimer = setTimeout(render, 250); } });
  render();
  root.appendChild(el);
  return { unmount: () => { off(); off2(); clearTimeout(terrTimer); } };
}

export function cleanStatus() {
  const st = state.stats; if (!st) return esc(t('cln.noTrack'));
  return tx('cln.status', { takeoff: st.takeoff ? fmtDateTimeUTC(st.takeoff.t) : '–', landing: st.landing ? fmtDateTimeUTC(st.landing.t) : '–', dur: fmtDurationHM(st.durationSec), landings: st.landings, segs: state.track.segments.length });
}
