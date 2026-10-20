// Höhenprofil as inline SVG: altitude over time (or distance), line coloured by vario or altitude,
// night bands, hour ticks, start/landing, markers, max label, hover crosshair; ground-speed trace below.

import { fmtTimeUTC, fmtDayUTC, fmtInt } from '../util/format.js';

const W = 1180, H = 300, PL = 54, PR = 16, PT = 14, PB = 32, GH = 70;

/**
 * data: {pts (display points with .cls), colors, xMode: 'time'|'dist', night, markers, takeoff, landing, units,
 *        altMax: {v,t}, labels: {max, night, takeoff, landing}, onHover(q|null)}
 * Returns {el, setHover(q)}
 */
export function renderProfile(container, data) {
  const pts = data.pts.filter((q) => !Number.isNaN(q.alt));
  if (!pts.length) { container.innerHTML = ''; return { setHover() {} }; }
  const u = data.units;
  const xs = data.xMode === 'dist' ? (q) => q.dist : (q) => q.t;
  const x0 = xs(pts[0]), x1 = xs(pts[pts.length - 1]), xspan = Math.max(1, x1 - x0);
  const X = (v) => PL + (v - x0) / xspan * (W - PL - PR);
  const alts = pts.map((q) => q.alt), lows = [...alts, ...((data.terrain || []).map((g) => g.alt).filter((a) => !Number.isNaN(a))), ...(data.showBottom ? (data.terrain || []).map((g) => g.bottom).filter((a) => !Number.isNaN(a)) : [])];
  const aMinRaw = Math.min(...lows), aMaxRaw = Math.max(...alts);
  // axis from a nice step below the lowest altitude (ground/terrain) to a nice step above the highest
  const vMin = u.altValue(aMinRaw), vMax = u.altValue(aMaxRaw), span = Math.max(50, vMax - vMin), step = niceStep(span / 5);
  const aMin = u.altFromValue(Math.floor((vMin - span * 0.02) / (step / 5)) * (step / 5));
  const aMax = Math.ceil((vMax + span * 0.06) / step) * step;
  const Y = (m) => PT + (1 - (u.altValue(m) - u.altValue(aMin)) / Math.max(1, aMax - u.altValue(aMin))) * (H - PT - PB);
  const gMax = Math.max(1, ...pts.map((q) => (Number.isNaN(q.gs) ? 0 : u.speedValue(q.gs))));
  const gTop = niceCeil(gMax * 1.1);
  const GY = (ms) => H + 8 + (1 - u.speedValue(ms) / gTop) * (GH - 16);
  const out = [];
  // area + night
  out.push(`<path d="M${pts.map((q) => `${X(xs(q)).toFixed(1)} ${Y(q.alt).toFixed(1)}`).join(' L')} L${X(xs(pts[pts.length - 1])).toFixed(1)} ${Y(aMin).toFixed(1)} L${X(xs(pts[0])).toFixed(1)} ${Y(aMin).toFixed(1)} Z" fill="#eef1f5"/>`);
  if (data.xMode === 'time') for (const iv of data.night) { const a = X(iv.from), b = X(iv.to); out.push(`<rect x="${a.toFixed(1)}" y="${PT}" width="${(b - a).toFixed(1)}" height="${H - PT - PB}" fill="#14202e" fill-opacity="0.07"/>`); if (b - a > 90) out.push(`<text x="${((a + b) / 2).toFixed(1)}" y="${PT + 12}" text-anchor="middle" font-size="11" fill="#5b6b7f">${esc(data.labels.night)} ${fmtTimeUTC(iv.from)}–${fmtTimeUTC(iv.to)} UTC</text>`); }
  // terrain (ground profile) with water surfaces shaded blue – drawn above the night band, below the grid
  const terr = (data.terrain || []).filter((g) => !Number.isNaN(g.alt) && g.x >= x0 && g.x <= x1).sort((a, b) => a.x - b.x);
  if (terr.length > 1) {
    const yb = Y(aMin);
    out.push(`<path d="M${terr.map((g) => `${X(g.x).toFixed(1)} ${Y(g.alt).toFixed(1)}`).join(' L')} L${X(terr[terr.length - 1].x).toFixed(1)} ${yb.toFixed(1)} L${X(terr[0].x).toFixed(1)} ${yb.toFixed(1)} Z" fill="#cfd6de" fill-opacity="0.85"/>`);
    // water: runs of samples on water → blue fill from the ground line down
    let run = [];
    const flushW = () => { if (run.length > 1) { out.push(`<path d="M${run.map((g) => `${X(g.x).toFixed(1)} ${Y(g.alt).toFixed(1)}`).join(' L')} L${X(run[run.length - 1].x).toFixed(1)} ${yb.toFixed(1)} L${X(run[0].x).toFixed(1)} ${yb.toFixed(1)} Z" fill="#8fbdeb" fill-opacity="0.9"/><path d="M${run.map((g) => `${X(g.x).toFixed(1)} ${Y(g.alt).toFixed(1)}`).join(' L')}" fill="none" stroke="#2f7fd6" stroke-width="2"/>`); } run = []; };
    for (let k = 0; k < terr.length; k++) { if (terr[k].water) { if (!run.length && k > 0) run.push(terr[k - 1]); run.push(terr[k]); } else { if (run.length) run.push(terr[k]); flushW(); } }
    flushW();
    out.push(`<path d="M${terr.map((g) => `${X(g.x).toFixed(1)} ${Y(g.alt).toFixed(1)}`).join(' L')}" fill="none" stroke="#7d8b9b" stroke-width="1.2"/>`);
    // optional: bed of the water bodies crossed (bathymetry), light brown, runs separately
    if (data.showBottom) {
      let seg = [];
      const flushB = () => { if (seg.length > 1) out.push(`<path d="M${seg.map((g) => `${X(g.x).toFixed(1)} ${Y(g.bottom).toFixed(1)}`).join(' L')}" fill="none" stroke="#b08968" stroke-width="1.4" stroke-dasharray="5 3"/>`); seg = []; };
      for (const g of terr) { if (!Number.isNaN(g.bottom)) seg.push(g); else flushB(); }
      flushB();
    }
  }
  // y grid
  const ySteps = niceSteps(u.altValue(aMin), aMax, 5);
  for (const v of ySteps) { const y = PT + (1 - (v - u.altValue(aMin)) / Math.max(1, aMax - u.altValue(aMin))) * (H - PT - PB); out.push(`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="#e4e8ee"/><text x="${PL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#5b6b7f" font-family="IBM Plex Mono, monospace">${fmtInt(v)}</text>`); }
  out.push(`<text x="${PL - 6}" y="${PT - 3}" text-anchor="end" font-size="10" fill="#5b6b7f">${u.altUnit}</text>`);
  // x ticks
  if (data.xMode === 'time') {
    const hours = xspan / 3600000; const stepH = hours > 60 ? 6 : hours > 30 ? 3 : hours > 12 ? 2 : hours > 4 ? 1 : 0.5;
    const first = Math.ceil(x0 / (stepH * 3600000)) * stepH * 3600000;
    for (let m = first; m <= x1; m += stepH * 3600000) { const d = new Date(m); const lab = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? fmtDayUTC(m) : fmtTimeUTC(m); const x = X(m); out.push(`<line x1="${x.toFixed(1)}" y1="${H - PB}" x2="${x.toFixed(1)}" y2="${H - PB + 5}" stroke="#9aa7b6"/><text x="${x.toFixed(1)}" y="${H - PB + 18}" text-anchor="middle" font-size="11" fill="#5b6b7f" font-family="IBM Plex Mono, monospace">${lab}</text>`); }
  } else {
    for (const v of niceSteps(0, xspan / 1000, 8)) { const x = X(x0 + v * 1000); out.push(`<line x1="${x.toFixed(1)}" y1="${H - PB}" x2="${x.toFixed(1)}" y2="${H - PB + 5}" stroke="#9aa7b6"/><text x="${x.toFixed(1)}" y="${H - PB + 18}" text-anchor="middle" font-size="11" fill="#5b6b7f" font-family="IBM Plex Mono, monospace">${fmtInt(v)} km</text>`); }
  }
  // coloured line (runs by class), gaps dashed
  let d = '', cls = -1, prev = null;
  const flush = () => { if (d) out.push(`<path d="${d}" stroke="${data.colors[cls]}" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`); d = ''; };
  for (const q of pts) {
    if (q.gap && prev) { flush(); out.push(`<line x1="${X(xs(prev)).toFixed(1)}" y1="${Y(prev.alt).toFixed(1)}" x2="${X(xs(q)).toFixed(1)}" y2="${Y(q.alt).toFixed(1)}" stroke="#9aa7b6" stroke-dasharray="4 4"/>`); prev = null; }
    if (q.cls !== cls) { flush(); cls = q.cls; d = prev ? `M${X(xs(prev)).toFixed(1)} ${Y(prev.alt).toFixed(1)}` : ''; }
    d += `${d ? ' L' : 'M'}${X(xs(q)).toFixed(1)} ${Y(q.alt).toFixed(1)}`; prev = q;
  }
  flush();
  // markers, takeoff, landing, max
  const xq = (q) => (data.xMode === 'dist' ? q.dist : q.t);
  for (const m of data.markers) if (!Number.isNaN(m.alt)) out.push(`<circle cx="${X(data.xMode === 'dist' ? m.dist : m.t).toFixed(1)}" cy="${Y(m.alt).toFixed(1)}" r="2.5" fill="#fff" stroke="#14202e" stroke-width="1.2"/>`);
  const vline = (q, color, label, anchor) => { if (!q) return; const x = X(xq(q)); out.push(`<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${H - PB}" stroke="${color}" stroke-dasharray="3 3"/><text x="${(x + (anchor === 'end' ? -4 : 4)).toFixed(1)}" y="${H - PB - 6}" font-size="11" fill="${color}" font-weight="600" text-anchor="${anchor}">${esc(label)} ${fmtTimeUTC(q.t)}</text>`); };
  vline(data.takeoff, '#1f8a4c', data.labels.takeoff, 'start');
  vline(data.landing, '#c0392b', data.labels.landing, 'end');
  for (const e of data.extremes || []) { const ex = data.xMode === 'dist' ? e.dist : e.t; if (Number.isNaN(e.alt) || Number.isNaN(ex) || ex < x0 || ex > x1) continue; out.push(`<text x="${X(ex).toFixed(1)}" y="${(Y(e.alt) + 5).toFixed(1)}" text-anchor="middle" font-size="14" fill="${e.color}" paint-order="stroke" stroke="#fff" stroke-width="3"><title>${esc(e.label || '')}</title>${e.symbol}</text>`); }
  if (data.altMax) { const q = data.altMax; const x = X(xq(q)); out.push(`<circle cx="${x.toFixed(1)}" cy="${Y(q.alt).toFixed(1)}" r="3.5" fill="#14202e"/><text x="${(x + (x > W - 160 ? -6 : 6)).toFixed(1)}" y="${(Y(q.alt) - 5).toFixed(1)}" font-size="11" fill="#14202e" font-weight="600" text-anchor="${x > W - 160 ? 'end' : 'start'}">${esc(data.labels.max)} ${u.alt(q.alt)} · ${fmtTimeUTC(q.t)}</text>`); }
  for (const e of data.events || []) { const ex = data.xMode === 'dist' ? e.dist : e.t; if (Number.isNaN(e.alt) || Number.isNaN(ex) || ex < x0 || ex > x1) continue; out.push(`<line x1="${X(ex).toFixed(1)}" y1="${(H - PB)}" x2="${X(ex).toFixed(1)}" y2="${(H - PB - 10)}" stroke="${e.color || '#1f5fbf'}" stroke-width="2"/><circle cx="${X(ex).toFixed(1)}" cy="${Y(e.alt).toFixed(1)}" r="4" fill="#fff" stroke="${e.color || '#1f5fbf'}" stroke-width="2"><title>${esc(e.label || '')}</title></circle>`); }
  // ballast remaining (kg) from the event log: step line on a right-hand scale
  const bl = (data.ballast || []).filter((b) => !Number.isNaN(data.xMode === 'dist' ? b.dist : b.t) && !Number.isNaN(b.kg));
  if (bl.length) {
    const bMax = niceCeil(Math.max(...bl.map((b) => b.kg)) * 1.1);
    const BY = (kg) => PT + (1 - kg / bMax) * (H - PT - PB);
    let bd = '';
    bl.forEach((b, i) => { const bx = X(data.xMode === 'dist' ? b.dist : b.t).toFixed(1), by = BY(b.kg).toFixed(1); bd += i === 0 ? `M${bx} ${by}` : ` H${bx} V${by}`; });
    bd += ` H${X(x1).toFixed(1)}`;
    out.push(`<path d="${bd}" stroke="#d98c00" stroke-width="2" stroke-dasharray="5 3" fill="none"/>`);
    for (const b of bl) out.push(`<circle cx="${X(data.xMode === 'dist' ? b.dist : b.t).toFixed(1)}" cy="${BY(b.kg).toFixed(1)}" r="3" fill="#d98c00"><title>${fmtInt(b.kg)} kg · ${fmtTimeUTC(b.t)} UTC</title></circle>`);
    for (const v of [0, bMax / 2, bMax]) out.push(`<text x="${W - PR + 2}" y="${(BY(v) + 4).toFixed(1)}" font-size="10" fill="#d98c00" font-family="IBM Plex Mono, monospace">${fmtInt(v)}</text>`);
    out.push(`<text x="${W - PR}" y="${PT - 3}" text-anchor="end" font-size="10" fill="#d98c00">${esc(data.labels.ballast || 'Ballast')} kg</text>`);
  }
  // ground speed trace
  out.push(`<line x1="${PL}" y1="${H + 2}" x2="${W - PR}" y2="${H + 2}" stroke="#e4e8ee"/>`);
  for (const v of [0, gTop / 2, gTop]) { const y = H + 8 + (1 - v / gTop) * (GH - 16); out.push(`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="#eef1f5"/><text x="${PL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#5b6b7f" font-family="IBM Plex Mono, monospace">${fmtInt(v)}</text>`); }
  let gd = '', gp = null;
  for (const q of pts) { if (Number.isNaN(q.gs)) { gp = null; continue; } gd += `${gp && !q.gap ? ' L' : ' M'}${X(xs(q)).toFixed(1)} ${GY(q.gs).toFixed(1)}`; gp = q; }
  out.push(`<path d="${gd.trim()}" stroke="#5b6b7f" stroke-width="1.3" fill="none"/><text x="${W - PR}" y="${H + 16}" text-anchor="end" font-size="10" fill="#5b6b7f">${esc(data.labels.gs)} ${u.speedUnit}</text>`);
  // pinned + hover groups (filled by setPinned / setHover)
  out.push(`<g data-pinned></g><g data-hover></g>`);
  const total = H + GH;
  container.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${total}" role="img" aria-label="${esc(data.labels.aria)}" font-family="IBM Plex Sans, sans-serif">${out.join('')}</svg>`;
  const svg = container.querySelector('svg'), hg = svg.querySelector('[data-hover]'), pg = svg.querySelector('[data-pinned]');
  const xsArr = pts.map((q) => xs(q));
  const nearest = (clientX) => { const r = svg.getBoundingClientRect(); const px = (clientX - r.left) / r.width * W; const v = x0 + (px - PL) / (W - PL - PR) * xspan; let lo = 0, hi = xsArr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (xsArr[m] < v) lo = m + 1; else hi = m; } return pts[lo]; };
  svg.addEventListener('mousemove', (e) => { const q = nearest(e.clientX); setHover(q); data.onHover && data.onHover(q); });
  svg.addEventListener('mouseleave', () => { setHover(null); data.onHover && data.onHover(null); });
  svg.addEventListener('click', (e) => { const q = nearest(e.clientX); data.onClick && data.onClick(q); });
  svg.addEventListener('touchstart', (e) => { const q = nearest(e.touches[0].clientX); setHover(q); data.onHover && data.onHover(q); }, { passive: true });
  svg.addEventListener('touchmove', (e) => { const q = nearest(e.touches[0].clientX); setHover(q); data.onHover && data.onHover(q); }, { passive: true });
  svg.addEventListener('touchend', (e) => { const x = e.changedTouches && e.changedTouches[0]; if (x) { const q = nearest(x.clientX); data.onClick && data.onClick(q); } }, { passive: true });
  function setHover(q) {
    if (!q || Number.isNaN(q.alt) || Number.isNaN(xs(q))) { hg.innerHTML = ''; return; }
    const x = X(xs(q)), y = Y(q.alt);
    hg.innerHTML = `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${H + GH - 8}" stroke="#14202e" stroke-width="1"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#f6b03d" stroke="#14202e" stroke-width="1.5"/>`;
  }
  /** Persistent marker set by a click on the map or the profile. */
  function setPinned(q) {
    if (!q || Number.isNaN(q.alt) || Number.isNaN(xs(q))) { pg.innerHTML = ''; return; }
    const x = X(xs(q)), y = Y(q.alt);
    pg.innerHTML = `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${H + GH - 8}" stroke="#1f5fbf" stroke-width="2"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#fff" stroke="#1f5fbf" stroke-width="2.5"/><text x="${(x + (x > W - 120 ? -8 : 8)).toFixed(1)}" y="${PT + 12}" font-size="11" font-weight="600" fill="#1f5fbf" text-anchor="${x > W - 120 ? 'end' : 'start'}" font-family="IBM Plex Mono, monospace">${fmtTimeUTC(q.t)}</text>`;
  }
  if (data.pinned) setPinned(data.pinned);
  return { setHover, setPinned };
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw)))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
function niceCeil(v) { if (v <= 0) return 10; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10; return n * p; }
function niceSteps(min, max, count) { const span = max - min; if (span <= 0) return [min]; const raw = span / count; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6)); return out; }
