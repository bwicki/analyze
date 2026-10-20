// Phase 3 · Auswerten: tiles, map, Kennzahlen, Höhenprofil (coupled hover), place names, events placeholder.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast, copyText } from '../util/dom.js';
import { fmtInt, fmtNum, fmtTimeUTC, fmtDateTimeUTC, fmtDurationHM, fmtDurationClock, fmtBearing, icaoShort, fmtLocalByLon, fmtDayUTC } from '../util/format.js';
import { makeUnits } from '../util/units.js';
import { state, bus, ignoreLanding } from '../state.js';
import { trackPoints, timeMarkers, extremePoints, markerMinutes } from '../process/track.js';
import { movingMean, indexAt } from '../process/series.js';
import { createMap, createDetailMap, VARIO_COLORS, GS_COLORS, GS_LIMITS_KT, varioClass, gsClass, LAYERS } from './map.js';
import { create3D } from './map3d.js';
import { renderProfile } from './profile.js';
import { downloadKmz } from '../export/download.js';
import { reverseGeocode } from '../util/places.js';
import { terrainForDisplay, groundAt } from '../terrain/store.js';
import { mountEventsCard, eventsForDisplay, ballastSeries } from './events.js';
import { mountPhotosCard, photosForDisplay } from './photos.js';
import { openViewer, adopt, fitBox, expandBtn, onPlainClick, LIST_ICON } from './viewer.js';

const DISPLAY_MAX = 3000;
const DETAIL_WINDOWS = [5, 10, 30];     // ± minutes around an extreme value in the detail viewer
const RECORD_WINDOWS = [1, 5, 30];      // ± minutes of the numeric record
const RECORD_MAX_ROWS = 6000;

export function mountAnalyze(root, ctx) {
  const el = html(`<main class="page">
    <div class="tiles" data-tiles></div>
    <div class="row-wrap">
      <section class="card" style="flex:2 1 620px">
        <div class="card-head"><h2>${esc(t('ana.map'))}</h2><div class="row-wrap noprint" style="gap:8px;align-items:center">
          <div class="seg" data-view><button type="button" data-v="2d" class="on">2D</button><button type="button" data-v="3d" title="${esc(t('ana.view3dTitle'))}">3D</button></div>
          <div class="seg" data-color><button type="button" data-c="vario">${esc(t('ana.color.vario'))}</button><button type="button" data-c="gs">${esc(t('ana.color.gs'))}</button></div>
          <select class="in sm" data-marker style="width:auto" title="${esc(t('ana.markerTitle'))}"><option value="auto">${esc(t('ana.markerAuto'))}</option><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option><option value="180">3 h</option></select>
        </div></div>
        <div class="map" data-map></div>
        <div class="map map3d" data-map3d hidden><div class="layer-radio map3d-layers" data-layers3d></div><div class="map3d-exag"><label>${esc(t('ana.exag'))} <select class="in sm" data-exag><option value="auto">${esc(t('ana.exagAuto'))}</option>${[1, 2, 5, 10, 20, 50, 100].map((x) => `<option value="${x}">${x}×</option>`).join('')}</select><span class="mono" data-exagval></span></label></div><div class="map3d-hint muted small">${esc(t('ana.view3dHint'))}</div></div>
        <div class="detail-maps" data-details></div>
        <div class="row-wrap noprint" style="gap:8px;align-items:center">
          <button class="btn chip" type="button" data-act="kmz">${esc(t('ana.googleEarth'))}</button>
          <a class="btn chip" data-gm-start target="_blank" rel="noopener">${esc(t('ana.gmStart'))}</a>
          <a class="btn chip" data-gm-land target="_blank" rel="noopener">${esc(t('ana.gmLanding'))}</a>
          <span class="muted small" style="margin-left:auto">${esc(t('ana.mapLegend'))}</span>
        </div>
      </section>
      <section class="card" style="flex:1 1 360px" data-stats></section>
    </div>
    <section class="card">
      <div class="card-head"><h2>${esc(t('ana.profile'))}</h2><div class="row-wrap noprint" style="gap:8px;align-items:center">
        <label class="chk small" data-bottomwrap hidden><input type="checkbox" data-bottom ${state.settings.showBottom ? 'checked' : ''}> ${esc(t('ana.showBottom'))}</label>
        <div class="seg" data-xmode><button type="button" data-x="time">${esc(t('ana.x.time'))}</button><button type="button" data-x="dist">${esc(t('ana.x.dist'))}</button></div>
      </div></div>
      <div class="readout" data-readout><span class="muted">${esc(t('ana.readoutHint'))}</span></div>
      <div class="gfx" data-gfx="profile"><div data-profile></div>${expandBtn('data-what="profile"')}</div>
      <div class="legend" data-legend></div>
    </section>
    <div data-eventscard style="display:contents"></div>
    <div data-photoscard style="display:contents"></div>
  </main>`);

  const mapEl = el.querySelector('[data-map]'), map3dEl = el.querySelector('[data-map3d]');
  let map = null, map3d = null, map3dLoading = false, view3d = false, profile = null, display = null, xMode = 'time', pinned = null, detailMaps = [];
  let bigProfile = null;   // the profile in the viewer while open (0.9.1): {box, readout, prof}
  const viewers = new Set();   // open viewers of this page (closed on unmount)
  const evCard = mountEventsCard(el.querySelector('[data-eventscard]'), { onSelect: (e) => { const q = e && !Number.isNaN(e.lat) ? { t: e.t, lat: e.lat, lon: e.lon, alt: e.alt, dist: e.dist, vsS: NaN, gs: NaN, fix: true } : null; map && map.setHover(q); map3d && map3d.setHover(q); profile && profile.setHover(q); readout(q || pinned); } });
  // click on the map or the profile pins a moment on both (hover stays transient)
  function pin(q) { pinned = q && q.fix ? q : null; map && map.setPinned(pinned); map3d && map3d.setPinned(pinned); profile && profile.setPinned(pinned); bigProfile && bigProfile.prof.setPinned(pinned); readout(pinned); }
  const phCard = mountPhotosCard(el.querySelector('[data-photoscard]'), { goto: (p) => ctx.goto(p), getPinned: () => pinned, onSelect: (p) => { const q = p && p.onTrack ? { t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, dist: p.dist, vsS: NaN, gs: NaN, fix: true } : null; map && map.setHover(q); map3d && map3d.setHover(q); profile && profile.setHover(q); readout(q || pinned); } });
  const shownEvents = () => [...eventsForDisplay().filter((e) => !evCard.hidden.has(e.type)), ...photosForDisplay()];
  const u = () => makeUnits(state.settings.units);

  const segBtns = (sel, attr, value) => el.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset[attr] === value));
  el.querySelectorAll('[data-color] button').forEach((b) => b.addEventListener('click', () => { state.settings.colorBy = b.dataset.c; ctx.saveSettings(); render(); }));
  el.querySelectorAll('[data-view] button').forEach((b) => b.addEventListener('click', () => { state.settings.view3d = b.dataset.v === '3d'; ctx.saveSettings(); setView(b.dataset.v === '3d'); }));
  el.querySelector('[data-bottom]').addEventListener('change', (e) => { state.settings.showBottom = e.target.checked; ctx.saveSettings(); renderProfileCard(); });
  // layer radios of the 3D view (same choice as the 2D map)
  const layers3d = el.querySelector('[data-layers3d]');
  layers3d.innerHTML = Object.keys(LAYERS).map((k) => `<label><input type="radio" name="layer3d" value="${k}"> ${esc(t('ana.layer.' + k))}</label>`).join('');
  layers3d.addEventListener('change', (e) => { const k = e.target.value; state.settings.mapLayer = k; ctx.saveSettings(); map && map.setLayer(k); map3d && map3d.setLayer(k); });
  const syncLayers3d = () => layers3d.querySelectorAll('input').forEach((i) => { i.checked = i.value === state.settings.mapLayer; });
  const exagSel = el.querySelector('[data-exag]'), exagVal = el.querySelector('[data-exagval]');
  exagSel.value = String(state.settings.exag ?? 10); if (exagSel.value !== String(state.settings.exag ?? 10)) exagSel.value = '10';
  exagSel.addEventListener('change', () => { state.settings.exag = exagSel.value === 'auto' ? 'auto' : +exagSel.value; ctx.saveSettings(); if (map3d) { map3d.setExaggeration(exagSel.value); exagVal.textContent = `${map3d.exaggeration}×`; } });

  /** Switch between the Leaflet map and the MapLibre 3D view (created on first use). */
  async function setView(to3d) {
    view3d = to3d;
    el.querySelectorAll('[data-view] button').forEach((b) => b.classList.toggle('on', (b.dataset.v === '3d') === to3d));
    mapEl.hidden = to3d; map3dEl.hidden = !to3d;
    if (!to3d) { map && map.invalidate(); return; }
    syncLayers3d();
    if (!map3d && !map3dLoading) {
      map3dLoading = true; map3dEl.classList.add('loading');
      try { map3d = await create3D(map3dEl, { layer: state.settings.mapLayer, exaggeration: exagSel.value, onApplied: () => { exagVal.textContent = `${map3d ? map3d.exaggeration : 1}×`; }, onExpand: () => openGraphic('map3d'), expandLabel: t('vw.expand') }); if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) globalThis.__map3d = map3d; }
      catch (e) { console.warn(e); toast(t('ana.view3dFailed'), true); map3dLoading = false; map3dEl.classList.remove('loading'); setView(false); return; }
      map3dLoading = false; map3dEl.classList.remove('loading');
      if (pinned) map3d.setPinned(pinned);
    }
    if (map3d) { map3d.resize(); render3D(true); }
  }
  function render3D(refit = false) {
    if (!map3d || !display) return;
    map3d.setTrack({ pts: display.pts, colors: display.colors, night: display.night, takeoff: display.takeoff, landing: display.landing, intermediate: display.intermediate, extremes: display.extremes, ground: (q) => groundAt(q.i), onExtreme: (x) => openExtremeViewer(x) }, { refit });
    exagVal.textContent = `${map3d.exaggeration}×`;
  }
  el.querySelectorAll('[data-xmode] button').forEach((b) => b.addEventListener('click', () => { xMode = b.dataset.x; renderProfileCard(); segBtns('[data-xmode]', 'x', xMode); }));
  const markerSel = el.querySelector('[data-marker]'); markerSel.value = String(state.settings.markerMin);
  markerSel.addEventListener('change', () => { state.settings.markerMin = markerSel.value === 'auto' ? 'auto' : +markerSel.value; state.settings.markerTouched = true; ctx.saveSettings(); render(); });
  onAct(el, {
    kmz: () => downloadKmz(10),
    copy: async () => { const txt = statsText(); if (await copyText(txt)) toast(t('common.copied')); },
    units: (b) => { state.settings.units = b.dataset.u; ctx.saveSettings(); render(); },
    geocode: () => fetchPlaces(true),
    ignore: (b) => { ignoreLanding(+b.dataset.t); toast(t('ana.landingIgnored')); },
    // 0.9.1: the symbol opens the detail viewer (map + profile of that part of the flight), the list icon the numeric record
    locate: (b) => { const x = display && display.extremes.find((e) => e.kind === b.dataset.kind); if (x) openExtremeViewer(x); },
    record: (b) => { const x = display && display.extremes.find((e) => e.kind === b.dataset.kind); if (x) openRecordViewer(x); },
    expand: (b) => openGraphic(b.dataset.what, b),
  });
  el.querySelector('[data-gfx="profile"]').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) openGraphic('profile'); });

  function buildDisplay() {
    const s = state; if (!s.track || !s.stats) return null;
    const dur = (s.trim.to - s.trim.from) / 1000;
    const step = Math.max(1, Math.ceil(dur / DISPLAY_MAX));
    const pts = trackPoints(s.track, s.series, s.trim, step);
    // smoothed vario for colouring at the display resolution
    const half = Math.max(45, step);
    const vsS = movingMean(s.track.points.t, s.series.vs, half);
    const colorBy = s.settings.colorBy === 'gs' ? 'gs' : 'vario';
    for (const q of pts) { q.vsS = vsS[q.i]; q.cls = colorBy === 'gs' ? gsClass(q.gs) : varioClass(q.vsS); }
    const markers = timeMarkers(s.track, s.series, s.trim.from, s.trim.to, markerMinutes(s.settings.markerMin, s.stats.durationSec)).map((m) => ({ ...m, dist: s.series.dist[m.i] }));
    const st = s.stats;
    const mk = (e) => (e ? { t: e.t, lat: e.lat, lon: e.lon, alt: e.alt, dist: s.series.dist[e.idx] } : null);
    const altMax = st.altMax ? { t: st.altMax.t, alt: st.altMax.v, dist: s.series.dist[indexAt(s.track.points.t, st.altMax.t)] } : null;
    const un = makeUnits(s.settings.units);
    const extremes = extremePoints(s.track, s.series, st).map((x) => ({ ...x, label: extremeLabel(x, un) }));
    return { pts, markers, step, colors: colorBy === 'gs' ? GS_COLORS : VARIO_COLORS, takeoff: mk(st.takeoff), landing: mk(st.landing), intermediate: st.intermediate.map((l) => ({ lat: l.lat, lon: l.lon, t: l.t, name: state.places.inter[l.t] || '' })), altMax, extremes, night: st.night.intervals, events: shownEvents(), ballast: ballastSeries() };
  }

  function render() {
    display = buildDisplay();
    segBtns('[data-color]', 'c', state.settings.colorBy === 'gs' ? 'gs' : 'vario'); segBtns('[data-xmode]', 'x', xMode);
    renderTiles(); renderStats(); renderMap(); renderProfileCard(); renderLegend(); render3D(false);
    if (state.settings.geocode) fetchPlaces(false);
  }

  function renderMap() {
    if (!display) return;
    if (!map) {
      map = createMap(mapEl, { layer: state.settings.mapLayer, fitLabel: t('ana.fit'), layerLabels: layerLabels(), onExpand: () => openGraphic('map'), expandLabel: t('vw.expand') }); if (!map) return;
      map.onHover((q) => { profile && profile.setHover(q); bigProfile && bigProfile.prof.setHover(q); readout(q || pinned); }); map.onClick((q) => pin(q));
      map.onLayerChange((k) => { state.settings.mapLayer = k; ctx.saveSettings(); map3d && map3d.setLayer(k); syncLayers3d(); });
    }
    const mm = markerMinutes(state.settings.markerMin, state.stats.durationSec);
    const every = mm >= 180 ? 1 : mm >= 60 ? 3 : mm >= 30 ? 6 : mm >= 15 ? 12 : 18;
    map.setTrack({ ...display, labelEvery: every, takeoffLabel: `${t('wp.takeoff')} ${fmtTimeUTC(display.takeoff ? display.takeoff.t : 0)} UTC`, landingLabel: `${t('wp.landing')} ${fmtTimeUTC(display.landing ? display.landing.t : 0)} UTC`, intermediateLabel: t('wp.intermediate'), ignoreLabel: t('ana.ignoreLanding'), onIgnoreIntermediate: state.viewer ? null : (ms) => { ignoreLanding(ms); toast(t('ana.landingIgnored')); }, onExtreme: (x) => openExtremeViewer(x) });
    if (pinned) map.setPinned(pinned);
    renderDetailMaps();
    const st = state.stats;
    const gm = (p) => (p && !Number.isNaN(p.lat) ? `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lon.toFixed(6)}` : '#');
    el.querySelector('[data-gm-start]').href = gm(st.takeoff); el.querySelector('[data-gm-land]').href = gm(st.landing);
  }

  /** Two small maps under the main map: take-off place and landing place (or end of recording). */
  function renderDetailMaps() {
    const box = el.querySelector('[data-details]'); detailMaps.forEach((m) => m.remove()); detailMaps = [];
    const st = state.stats; if (!st || !display) { box.innerHTML = ''; return; }
    const land = st.landing || st.endFix;
    const cap = (label, place, p) => `${esc(label)} · ${esc(place || icaoShort(p.lat, p.lon))} · ${fmtDateTimeUTC(p.t)}`;
    const capStart = cap(t('wp.takeoff'), state.places.takeoff, st.takeoff), capLand = land ? cap(st.landing ? t('wp.landing') : t('st.endOfRecording'), st.landing ? state.places.landing : '', land) : '';
    box.innerHTML = `<div><div class="pk">${capStart}</div><div class="gfx click" data-gfx="dstart"><div class="map" data-dstart></div>${expandBtn('data-what="dstart"')}</div></div>
      ${land ? `<div><div class="pk">${capLand}</div><div class="gfx click" data-gfx="dland"><div class="map" data-dland></div>${expandBtn('data-what="dland"')}</div></div>` : ''}`;
    const near = (p) => display.pts.filter((q) => q.fix && Math.abs(q.t - p.t) < 45 * 60000).map((q) => [q.lat, q.lon]);
    const a = createDetailMap(box.querySelector('[data-dstart]'), { lat: st.takeoff.lat, lon: st.takeoff.lon, color: '#1f8a4c', near: near(st.takeoff) }); if (a) detailMaps.push(a);
    if (land) { const b = createDetailMap(box.querySelector('[data-dland]'), { lat: land.lat, lon: land.lon, color: st.landing ? '#c0392b' : '#d98c00', near: near(land) }); if (b) detailMaps.push(b); }
    // 0.9.1: a plain click (no drag) on a detail map opens it large
    const bigDetail = (which) => { const p = which === 'dstart' ? st.takeoff : land; if (!p) return; const v = openV({ title: which === 'dstart' ? capStart : capLand, cls: 'fill' }); const m = document.createElement('div'); m.className = 'map'; v.body.appendChild(m); const dm = createDetailMap(m, { lat: p.lat, lon: p.lon, color: which === 'dstart' ? '#1f8a4c' : (st.landing ? '#c0392b' : '#d98c00'), near: near(p), zoom: 14 }); if (dm) v.onClose(() => dm.remove()); };
    detailOpeners.dstart = () => bigDetail('dstart'); detailOpeners.dland = () => bigDetail('dland');
    for (const w of ['dstart', 'dland']) { const g = box.querySelector(`[data-gfx="${w}"]`); if (g) onPlainClick(g, () => detailOpeners[w]()); }
  }
  const detailOpeners = {};

  const profileLabels = () => ({ max: t('ana.max'), night: t('ana.night'), takeoff: t('wp.takeoff'), landing: t('wp.landing'), gs: t('ana.gs'), ballast: t('ev.type.Ballast'), aria: t('ana.profile') });
  const layerLabels = () => ({ osm: t('ana.layer.osm'), topo: t('ana.layer.topo'), sat: t('ana.layer.sat') });
  function renderProfileCard() {
    if (!display) return;
    const un = u();
    el.querySelector('[data-bottomwrap]').hidden = !(state.terrain && state.terrain.hasBottom);
    const data = { ...display, xMode, units: un, pinned, terrain: terrainForDisplay(xMode), showBottom: !!state.settings.showBottom, labels: profileLabels(), onExtreme: (x) => openExtremeViewer(x) };
    profile = renderProfile(el.querySelector('[data-profile]'), { ...data, onHover: (q) => { map && map.setHover(q); bigProfile && bigProfile.prof.setHover(q); readout(q || pinned); }, onClick: (q) => pin(q) });
    if (bigProfile) bigProfile.prof = renderProfile(bigProfile.box, { ...data, onHover: (q) => { map && map.setHover(q); map3d && map3d.setHover(q); profile && profile.setHover(q); bigProfile.readout.innerHTML = readoutHtml(q || pinned); readout(q || pinned); }, onClick: (q) => pin(q) });
  }

  /** Readout line (time, altitude, vario, speed, position, distance, AGL) for a point of the display track. */
  function readoutHtml(q, d0 = display ? display.pts[0].dist : 0) {
    const un = u();
    if (!q) return `<span class="muted">${esc(t('ana.readoutHint'))}</span>`;
    return `<span>${esc(t('ana.r.time'))} <b>${fmtDayUTC(q.t)} ${fmtTimeUTC(q.t, true)} UTC</b></span><span>${esc(t('ana.r.alt'))} <b>${un.alt(q.alt, true)}</b></span><span>${esc(t('ana.r.vs'))} <b>${un.vs(q.vsS)}</b></span><span>${esc(t('ana.r.gs'))} <b>${un.speed(q.gs, 1)}</b></span><span>${esc(t('ana.r.pos'))} <b>${icaoShort(q.lat, q.lon)}</b></span><span>${esc(t('ana.r.dist'))} <b>${un.dist(q.dist - d0)}</b></span>${Number.isFinite(groundAt(q.i)) ? `<span>${esc(t('ana.r.agl'))} <b>${un.alt(Math.max(0, q.alt - groundAt(q.i)))}</b></span>` : ''}`;
  }
  function readout(q) { el.querySelector('[data-readout]').innerHTML = readoutHtml(q); }

  // ---- 0.9.1: viewers (full-screen) -------------------------------------------------------------
  const statusLine = () => analyzeStatus().replace(/<[^>]+>/g, '');   // tx() output is escaped HTML already
  function openV(o) { const v = openViewer(o); viewers.add(v); v.onClose(() => viewers.delete(v)); return v; }
  /** Large view of a graphic of this page: map (moved into the viewer), 3D view (moved), profile (rendered anew), detail maps. */
  function openGraphic(what) {
    if (!display) return;
    if (what === 'map' || what === 'map3d') {
      const node = what === 'map3d' ? map3dEl : mapEl; if (node.hidden) return;
      const v = openV({ title: `${esc(t('ana.map'))} · ${what === 'map3d' ? '3D' : '2D'}`, sub: statusLine(), cls: 'fill' });
      const back = adopt(node, v.body);
      const resize = () => { if (what === 'map3d') { if (map3d) { map3d.resize(); map3d.fit(); } } else map && map.invalidate(); };
      setTimeout(resize, 30);
      v.onClose(() => { back(); setTimeout(resize, 30); });
      return;
    }
    if (what === 'profile') {
      const v = openV({ title: esc(t('ana.profile')), sub: statusLine() });
      const box = fitBox(v, 1180 / 370 * 0.92);
      box.innerHTML = `<div class="readout" data-vreadout></div><div data-vprofile></div>`;
      bigProfile = { box: box.querySelector('[data-vprofile]'), readout: box.querySelector('[data-vreadout]'), prof: null };
      bigProfile.readout.innerHTML = readoutHtml(pinned);
      renderProfileCard();
      v.onClose(() => { bigProfile = null; });
      return;
    }
    if (detailOpeners[what]) detailOpeners[what]();
  }

  const extremeName = (x) => t(x.kind === 'alt' ? 'st.altMax' : x.kind === 'gs' ? 'ana.xGs' : x.kind === 'up' ? 'ana.xUp' : 'ana.xDown');
  const extremeValue = (x, un) => (x.kind === 'alt' ? un.alt(x.value, true) : x.kind === 'gs' ? un.speed(x.value) : un.vs(x.value));
  const extremeTitle = (x, un) => `<span style="color:${x.color}">${x.symbol}</span> ${esc(extremeName(x))} <span class="mono">${esc(extremeValue(x, un))}</span>`;

  /**
   * Detail viewer of an extreme value (0.9.1): map and profile of the ± window around the point, coupled hover,
   * the symbol marked, the rest of the flight grey on the map; window ± 5/10/30 min; «Aufzeichnung» opens the record.
   */
  function openExtremeViewer(x) {
    if (!x || !state.track) return;
    pin(x);
    const un = u(), s = state, st = s.stats;
    let win = DETAIL_WINDOWS[1];
    const v = openV({
      title: extremeTitle(x, un), sub: `${fmtDayUTC(x.t)} ${fmtTimeUTC(x.t, true)} UTC · ${icaoShort(x.lat, x.lon)}`,
      tools: `<div class="seg sm" data-win>${DETAIL_WINDOWS.map((m) => `<button type="button" data-m="${m}" class="${m === win ? 'on' : ''}">± ${m} min</button>`).join('')}</div><button class="btn sm" type="button" data-act="record">${LIST_ICON} ${esc(t('vw.record'))}</button>`,
    });
    v.body.innerHTML = `<div class="vstack"><div class="map" data-vmap></div><div class="vprof" data-vprof><div class="readout" data-vreadout></div><div data-vprofile></div><div class="muted small">${esc(t('vw.detailHint'))}</div></div></div>`;
    const mapBox = v.body.querySelector('[data-vmap]'), profBox = v.body.querySelector('[data-vprofile]'), ro = v.body.querySelector('[data-vreadout]'), profWrap = v.body.querySelector('[data-vprof]');
    // the profile takes ~40 % of the height (its width follows), the map the rest
    const sizeProf = () => { const bh = v.body.clientHeight, bw = v.body.clientWidth; if (bh <= 0) return; profWrap.style.width = `${Math.min(bw, Math.max(480, (bh * 0.4 - 90) * 1180 / 370))}px`; };
    sizeProf(); if (typeof ResizeObserver !== 'undefined') { const rob = new ResizeObserver(() => { sizeProf(); dmap && dmap.invalidate(); }); rob.observe(v.body); v.onClose(() => rob.disconnect()); }
    let dmap = null, dprof = null, ctxLine = null, vpinned = x, d0 = 0;
    const vread = (q) => { ro.innerHTML = readoutHtml(q || vpinned); };
    const vpin = (q) => { vpinned = q && q.fix ? q : x; dmap && dmap.setPinned(vpinned); dprof && dprof.setPinned(vpinned); vread(vpinned); pin(vpinned); };
    const build = () => {
      const trim = { from: Math.max(s.trim.from, x.t - win * 60000), to: Math.min(s.trim.to, x.t + win * 60000) };
      const dur = (trim.to - trim.from) / 1000, step = Math.max(1, Math.ceil(dur / 1500));
      const pts = trackPoints(s.track, s.series, trim, step);
      const vsS = movingMean(s.track.points.t, s.series.vs, Math.max(15, step));
      for (const q of pts) { q.vsS = vsS[q.i]; q.cls = varioClass(q.vsS); }
      d0 = display ? display.pts[0].dist : (pts[0] ? pts[0].dist : 0);
      const inWin = (p) => p && !Number.isNaN(p.lat) && p.t >= trim.from && p.t <= trim.to;
      const mk = (e) => (e ? { t: e.t, lat: e.lat, lon: e.lon, alt: e.alt, dist: s.series.dist[e.idx] } : null);
      const markers = timeMarkers(s.track, s.series, trim.from, trim.to, 1).map((m) => ({ ...m, dist: s.series.dist[m.i] }));
      const data = { pts, markers, step, colors: VARIO_COLORS, takeoff: inWin(st.takeoff) ? mk(st.takeoff) : null, landing: inWin(st.landing) ? mk(st.landing) : null, intermediate: st.intermediate.filter(inWin).map((l) => ({ lat: l.lat, lon: l.lon, t: l.t, name: state.places.inter[l.t] || '' })), extremes: (display ? display.extremes : []).filter(inWin), night: st.night.intervals, events: shownEvents().filter(inWin), ballast: [], altMax: null };
      if (!dmap) {
        dmap = createMap(mapBox, { layer: state.settings.mapLayer, fitLabel: t('ana.fit'), layerLabels: layerLabels() });
        if (dmap) { dmap.onHover((q) => { dprof && dprof.setHover(q); vread(q); }); dmap.onClick((q) => vpin(q)); dmap.onLayerChange((k) => { state.settings.mapLayer = k; ctx.saveSettings(); map && map.setLayer(k); map3d && map3d.setLayer(k); syncLayers3d(); }); }
      }
      if (dmap) {
        dmap.setTrack({ ...data, labelEvery: 5, takeoffLabel: `${t('wp.takeoff')} ${fmtTimeUTC(st.takeoff ? st.takeoff.t : 0)} UTC`, landingLabel: `${t('wp.landing')} ${fmtTimeUTC(st.landing ? st.landing.t : 0)} UTC`, intermediateLabel: t('wp.intermediate'), onExtreme: (e) => { if (e.kind !== x.kind) { v.close(); openExtremeViewer(e); } } });
        // the rest of the flight as a grey context line (added after setTrack: it must not widen the fit)
        const Lf = globalThis.L;
        if (ctxLine) { try { dmap.map.removeLayer(ctxLine); } catch { /* stub */ } ctxLine = null; }
        if (Lf && display) { ctxLine = Lf.polyline(display.pts.filter((q) => q.fix).map((q) => [q.lat, q.lon]), { color: '#9aa7b6', weight: 2, opacity: 0.55, interactive: false }).addTo(dmap.map); ctxLine.bringToBack && ctxLine.bringToBack(); }
        dmap.setPinned(vpinned);
      }
      dprof = renderProfile(profBox, { ...data, xMode: 'time', units: un, pinned: vpinned, terrain: terrainForDisplay('time'), showBottom: !!state.settings.showBottom, labels: profileLabels(), onHover: (q) => { dmap && dmap.setHover(q); vread(q); }, onClick: (q) => vpin(q), onExtreme: (e) => { if (e.kind !== x.kind) { v.close(); openExtremeViewer(e); } } });
      vread(vpinned);
    };
    v.el.querySelector('[data-win]').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; win = +b.dataset.m; v.el.querySelectorAll('[data-win] button').forEach((k) => k.classList.toggle('on', k === b)); build(); setTimeout(() => dmap && dmap.invalidate(), 30); });
    onAct(v.el, { record: () => openRecordViewer(x) });
    build();
    setTimeout(() => dmap && dmap.invalidate(), 60);
    v.onClose(() => { dmap && dmap.destroy(); dmap = null; });
  }

  /** Numeric record around an extreme value (0.9.1): the track points ± 1/5/30 min as a table, the point's row marked. */
  function openRecordViewer(x) {
    if (!x || !state.track) return;
    const s = state, ps = s.track.points, se = s.series, un = u(), n = ps.n;
    const vs30 = movingMean(ps.t, se.vs, 15), gs10 = movingMean(ps.t, se.gs, 5);
    let hasBaro = false, hasBatt = false, hasHdg = false;
    for (let i = 0; i < n; i++) { if (!Number.isNaN(ps.balt[i])) hasBaro = true; if (!Number.isNaN(ps.batt[i])) hasBatt = true; if (!Number.isNaN(ps.hdg[i])) hasHdg = true; if (hasBaro && hasBatt && hasHdg) break; }
    let win = RECORD_WINDOWS[0];
    const v = openV({
      title: `${LIST_ICON} ${esc(t('vw.recordTitle'))} · ${extremeTitle(x, un)}`, sub: '',
      tools: `<div class="seg sm" data-win>${RECORD_WINDOWS.map((m) => `<button type="button" data-m="${m}" class="${m === win ? 'on' : ''}">± ${m} min</button>`).join('')}</div>`,
    });
    v.body.innerHTML = `<div class="vtable" data-tbl></div>`;
    const box = v.body.querySelector('[data-tbl]');
    const num = (val, d = 0) => (Number.isNaN(val) ? '–' : fmtNum(val, d));
    const build = () => {
      let a = indexAt(ps.t, x.t - win * 60000), b = indexAt(ps.t, x.t + win * 60000);
      if (b - a + 1 > RECORD_MAX_ROWS) { a = Math.max(0, x.i - RECORD_MAX_ROWS / 2); b = Math.min(n - 1, a + RECORD_MAX_ROWS - 1); }
      const rows = [];
      for (let i = a; i <= b; i++) {
        const isX = i === x.i, fix = ps.fix[i] === 1;
        rows.push(`<tr class="${isX ? 'hl' : ''}${fix ? '' : ' nofix'}"${isX ? ' data-xrow' : ''}><td class="r muted">${i}</td><td>${isX ? `<span style="color:${x.color}">${x.symbol}</span> ` : ''}${fmtTimeUTC(ps.t[i], true)}</td><td class="r">${Number.isNaN(se.altClean[i]) ? '–' : fmtInt(un.altValue(se.altClean[i]))}</td>${hasBaro ? `<td class="r">${Number.isNaN(ps.balt[i]) ? '–' : fmtInt(un.altValue(ps.balt[i]))}</td>` : ''}<td class="r">${num(se.vs[i], 1)}</td><td class="r">${num(vs30[i], 1)}</td><td class="r">${Number.isNaN(se.gs[i]) ? '–' : num(un.speedValue(se.gs[i]), 1)}</td><td class="r">${Number.isNaN(gs10[i]) ? '–' : num(un.speedValue(gs10[i]), 1)}</td>${hasHdg ? `<td class="r">${num(ps.hdg[i], 0)}</td>` : ''}<td class="r">${fix ? ps.lat[i].toFixed(5) : '–'}</td><td class="r">${fix ? ps.lon[i].toFixed(5) : '–'}</td><td>${fix ? '✓' : '–'}</td>${hasBatt ? `<td class="r">${num(ps.batt[i], 2)}</td>` : ''}</tr>`);
      }
      const th = (k, cls = 'r') => `<th class="${cls}">${esc(k)}</th>`;
      box.innerHTML = `<div class="muted small" style="margin-bottom:6px">${esc(t('vw.points', { n: fmtInt(b - a + 1), from: `${fmtDayUTC(ps.t[a])} ${fmtTimeUTC(ps.t[a], true)}`, to: `${fmtDayUTC(ps.t[b])} ${fmtTimeUTC(ps.t[b], true)}` }))} · ${esc(t('vw.recordHint'))}</div>
        <table class="tbl rec"><thead><tr>${th('#')}${th(t('vw.col.time'), '')}${th(`${t('vw.col.alt')} ${un.altUnit}`)}${hasBaro ? th(`${t('vw.col.balt')} ${un.altUnit}`) : ''}${th(`${t('vw.col.vs')} m/s`)}${th(`${t('vw.col.vs30')} m/s`)}${th(`${t('vw.col.gs')} ${un.speedUnit}`)}${th(`${t('vw.col.gs10')} ${un.speedUnit}`)}${hasHdg ? th(`${t('vw.col.hdg')} °`) : ''}${th(t('vw.col.lat'))}${th(t('vw.col.lon'))}${th(t('vw.col.fix'), '')}${hasBatt ? th(`${t('vw.col.batt')} V`) : ''}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
      const hl = box.querySelector('[data-xrow]'); if (hl && hl.scrollIntoView) setTimeout(() => hl.scrollIntoView({ block: 'center' }), 20);
    };
    v.el.querySelector('[data-win]').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; win = +b.dataset.m; v.el.querySelectorAll('[data-win] button').forEach((k) => k.classList.toggle('on', k === b)); build(); });
    build();
  }

  function terrainNote() {
    const tr = state.terrain; if (!tr || state.settings.terrain === false) return '';
    if (tr.status === 'loading' || tr.status === 'ground') return ` · ${esc(t('ana.terrainLoading', { pct: Math.round((tr.progress || 0) * 100) }))}`;
    if (tr.status === 'error') return ` · ${esc(t('ana.terrainFailed'))}`;
    return ` · ${esc(t('ana.terrainLegend'))}${tr.waterSource === 'none' ? ` (${esc(t('ana.waterSeaOnly'))})` : ''}`;
  }
  function renderLegend() {
    const lg = el.querySelector('[data-legend]');
    if (state.settings.colorBy === 'gs') {
      const un = u(), lim = GS_LIMITS_KT.map((kt) => Math.round(un.speedValue(kt * 0.514444)));
      const lab = [`&lt; ${lim[0]}`, `${lim[0]}–${lim[1]}`, `${lim[1]}–${lim[2]}`, `${lim[2]}–${lim[3]}`, `&gt; ${lim[3]} ${un.speedUnit}`];
      lg.innerHTML = `<span>${esc(t('ana.legendGs'))}</span>` + GS_COLORS.map((c, i) => `<span><span class="sw" style="background:${c}"></span> ${lab[i]}</span>`).join('') + `<span style="margin-left:auto">${esc(t('ana.legendNote'))}${terrainNote()}</span>`;
    }
    else lg.innerHTML = [`<span><span class="sw" style="background:${VARIO_COLORS[0]}"></span> ${esc(t('ana.sink'))} &lt; −0.5 m/s</span>`, `<span><span class="sw" style="background:${VARIO_COLORS[1]}"></span> −0.5 … −0.15</span>`, `<span><span class="sw" style="background:${VARIO_COLORS[2]}"></span> ${esc(t('ana.neutral'))}</span>`, `<span><span class="sw" style="background:${VARIO_COLORS[3]}"></span> +0.15 … +0.5</span>`, `<span><span class="sw" style="background:${VARIO_COLORS[4]}"></span> ${esc(t('ana.climb'))} &gt; +0.5 m/s</span>`, `<span style="margin-left:auto">${esc(t('ana.legendNote'))}${terrainNote()}</span>`].join('');
  }

  /** Symbol button of an extreme value – the same glyph as on map, 3D view and profile; opens the detail viewer (0.9.1). */
  function locBtn(kind) {
    const x = display && display.extremes.find((e) => e.kind === kind); if (!x) return '';
    return `<button type="button" class="loc noprint" data-act="locate" data-kind="${kind}" title="${esc(t('ana.locate'))}" style="color:${x.color}">${x.symbol}</button>`;
  }
  /** List button next to it: the numeric record around that point (0.9.1). */
  function listBtn(kind) {
    const x = display && display.extremes.find((e) => e.kind === kind); if (!x) return '';
    return `<button type="button" class="loc list noprint" data-act="record" data-kind="${kind}" title="${esc(t('vw.record'))}">${LIST_ICON}</button>`;
  }
  function extremeLabel(x, un) {
    const name = t(x.kind === 'alt' ? 'st.altMax' : x.kind === 'gs' ? 'ana.xGs' : x.kind === 'up' ? 'ana.xUp' : 'ana.xDown');
    const val = x.kind === 'alt' ? un.alt(x.value) : x.kind === 'gs' ? un.speed(x.value) : un.vs(x.value);
    return `${x.symbol} ${name} ${val} · ${fmtTimeUTC(x.t)} UTC`;
  }
  function renderTiles() {
    const st = state.stats, un = u();
    const tile = (k, v, unit, sub) => `<div class="tile"><span class="k">${esc(k)}</span><span class="v">${v}<small>${esc(unit)}</small></span><span class="u">${sub}</span></div>`;
    const noUnit = (str) => String(str).replace(/[\s\u00a0]*(km\/h|m\/s|km|ft|kt|m)$/, '');
    el.querySelector('[data-tiles]').innerHTML = [
      tile(t('st.duration'), fmtDurationClock(st.durationSec), 'h:min', `${st.landings} ${esc(t(st.landings === 1 ? 'st.landing1' : 'st.landingN'))}`),
      tile(t('st.distance'), noUnit(un.dist(st.distanceM)), 'km', `${un.dist(st.straightM)} ${esc(t('st.straightShort'))}`),
      tile(t('st.altMax'), st.altMax ? noUnit(un.alt(st.altMax.v)) : '–', un.altUnit, (st.altMax ? fmtTimeUTC(st.altMax.t) + ' UTC ' : '') + locBtn('alt')),
      tile(t('st.vs'), `<span style="font-size:20px">${st.vsMax ? noUnit(un.vs(st.vsMax.v)) : '–'} / ${st.vsMin ? noUnit(un.vs(st.vsMin.v)) : '–'}</span>`, 'm/s', esc(t('st.vsSub')) + ' ' + locBtn('up') + locBtn('down')),
      tile(t('st.gs'), `${st.gsMax ? fmtNum(un.speedValue(st.gsMax.v), 0) : '–'} / ${fmtNum(un.speedValue(st.gsMean), 0)}`, un.speedUnit, esc(t('st.gsSub')) + ' ' + locBtn('gs')),
      tile(t('st.night'), fmtDurationClock(st.night.totalSec), 'h:min', `${st.night.intervals.length} ${esc(t(st.night.intervals.length === 1 ? 'st.night1' : 'st.nightN'))}`),
    ].join('');
  }

  function placeLine(kind, p) {
    const name = kind === 'inter' ? state.places.inter[p.t] : state.places[kind];
    return `${name ? esc(name) + ' · ' : ''}${icaoShort(p.lat, p.lon)}`;
  }

  function renderStats() {
    const st = state.stats, un = u(), s = state.settings;
    const row = (k, v, sub = '') => `<div class="row"><span class="k2">${esc(k)}</span><span class="val">${v}${sub ? `<br><span class="sub">${sub}</span>` : ''}</span></div>`;
    const warm = st.accVertMax && st.accVertMax.v > 1.5;
    el.querySelector('[data-stats]').innerHTML = `<div class="card-head"><h2>${esc(t('ana.stats'))}</h2><div class="row-wrap noprint" style="gap:6px"><div class="seg"><button type="button" data-act="units" data-u="icao" class="${s.units !== 'metric' ? 'on' : ''}">ft · kt</button><button type="button" data-act="units" data-u="metric" class="${s.units === 'metric' ? 'on' : ''}">m · km/h</button></div><button class="btn chip" type="button" data-act="copy">${esc(t('ana.copy'))}</button></div></div>
      ${row(t('st.takeoff'), st.takeoff ? fmtDateTimeUTC(st.takeoff.t) : '–', st.takeoff ? `${fmtLocalByLon(st.takeoff.t, st.takeoff.lon)} · ${placeLine('takeoff', st.takeoff)}${st.takeoff.cut ? ` · ${esc(t('st.cutNote'))}` : ''}` : '')}
      ${row(t('st.landingAt'), st.landing ? fmtDateTimeUTC(st.landing.t) : (st.endFix ? fmtDateTimeUTC(st.endFix.t) : '–'), st.landing ? `${fmtLocalByLon(st.landing.t, st.landing.lon)} · ${placeLine('landing', st.landing)}${st.landing.cut ? ` · ${esc(t('st.cutNote'))}` : ''}` : (st.endFix ? `<span class="err">${esc(t('st.noLandingNote'))}</span> · ${icaoShort(st.endFix.lat, st.endFix.lon)}` : ''))}
      ${row(t('st.landings'), `${st.landings}`, st.intermediate.length ? st.intermediate.map((l) => `<span class="inter">${fmtTimeUTC(l.t)} UTC · ${esc(state.places.inter[l.t] || icaoShort(l.lat, l.lon))} (${fmtDurationHM(l.groundSec || 0)})${state.viewer ? '' : ` <button type="button" class="tt-x inline noprint" data-act="ignore" data-t="${l.t}" title="${esc(t('ana.ignoreLanding'))}">×</button>`}</span>`).join('<br>') + (state.ignoredLandings.length ? `<br><span class="muted">${esc(t('ana.ignoredCount', { n: state.ignoredLandings.length }))}</span>` : '') : esc(t('st.noIntermediate')) + (state.ignoredLandings.length ? ` · ${esc(t('ana.ignoredCount', { n: state.ignoredLandings.length }))}` : ''))}
      ${row(t('st.duration'), `<span class="big">${fmtDurationHM(st.durationSec)}</span>`, st.intermediate.length ? esc(t('st.airtime', { v: fmtDurationHM(st.airSec) })) : '')}
      ${row(t('st.distanceLine'), `${un.dist(st.distanceM)} · ${un.dist(st.straightM)} · ${fmtBearing(st.bearingDeg)}`)}
      ${row(t('st.altMaxGps'), st.altMax ? un.alt(st.altMax.v, true) : '–', st.altMax ? `${fmtDateTimeUTC(st.altMax.t)} ${locBtn('alt')}${listBtn('alt')}` : '')}
      ${st.baroMax ? row(t('st.altMaxBaro'), un.alt(st.baroMax.v, true)) : ''}
      ${row(t('st.altMean'), un.alt(st.altMean, true))}
      ${row(t('st.vsMax'), st.vsMax ? un.vs(st.vsMax.v) : '–', st.vsMax ? `${fmtDateTimeUTC(st.vsMax.t)} · ${esc(t('st.vs30'))} ${locBtn('up')}${listBtn('up')}` : '')}
      ${row(t('st.vsMin'), st.vsMin ? un.vs(st.vsMin.v) : '–', st.vsMin ? `${fmtDateTimeUTC(st.vsMin.t)} · ${esc(t('st.vs30'))} ${locBtn('down')}${listBtn('down')}` : '')}
      ${row(t('st.gsLine'), `${st.gsMax ? un.speed(st.gsMax.v) : '–'} · ${un.speed(st.gsMean)}`, esc(t('st.gsSub2')) + ' ' + locBtn('gs') + listBtn('gs'))}
      ${row(t('st.accV'), st.accVertMax ? un.acc(st.accVertMax.v) : '–', st.accVertMax ? `${fmtDateTimeUTC(st.accVertMax.t)} · ${esc(t('st.accDerived'))}${warm ? ' · ' + esc(t('st.check')) : ''}` : '')}
      ${row(t('st.accH'), st.accHorMax ? un.acc(st.accHorMax.v) : '–', st.accHorMax ? `${fmtDateTimeUTC(st.accHorMax.t)} · ${esc(t('st.accDerived'))}` : '')}
      ${row(t('st.touchdown'), st.touchdown.length ? st.touchdown.map((x) => un.vs(x.vs)).join(' · ') : '–', esc(t('st.touchdownSub')))}
      ${row(t('st.nightLine'), fmtDurationHM(st.night.totalSec), st.night.intervals.map((iv, k) => `${esc(t('st.nightN1', { n: k + 1 }))} ${fmtTimeUTC(iv.from)}–${fmtTimeUTC(iv.to)} UTC`).join(' · ') + ' · ' + esc(t('st.civil')))}
      ${row(t('st.segments'), `${state.track.segments.length} · ${st.restarts}${st.restarts ? ` (${st.restartList.map((r) => Math.round(r.sec) + ' s').join(', ')})` : ''}`, esc(t('st.segmentsSub', { points: fmtInt(st.nPoints), gaps: st.gaps.length })))}
      ${row(t('st.tracker'), esc([...new Set(state.files.filter((f) => f.profile).map((f) => f.profile.name))].join(', ') || '–'), st.batt ? `${fmtNum(st.batt.min, 2)}–${fmtNum(st.batt.max, 2)} V` : '')}
      ${(!state.places.takeoff || (st.landing && !state.places.landing)) && !state.viewer ? `<div class="row-wrap noprint" style="gap:8px;align-items:center;padding-top:6px"><button class="btn chip" type="button" data-act="geocode">${esc(t('ana.geocodeBtn'))}</button><span class="muted small">${esc(geoFailed ? t('ana.geocodeFailed') : (s.geocode === false ? t('ana.geocodeOff') : ''))}</span></div>` : ''}`;
  }

  function statsText() {
    const st = state.stats, un = u(); const L = [];
    L.push(`${t('st.takeoff')}: ${fmtDateTimeUTC(st.takeoff.t)} ${state.places.takeoff || ''} ${icaoShort(st.takeoff.lat, st.takeoff.lon)}`);
    if (st.landing) L.push(`${t('st.landingAt')}: ${fmtDateTimeUTC(st.landing.t)} ${state.places.landing || ''} ${icaoShort(st.landing.lat, st.landing.lon)}`);
    L.push(`${t('st.landings')}: ${st.landings}`, `${t('st.duration')}: ${fmtDurationHM(st.durationSec)}`, `${t('st.distanceLine')}: ${un.dist(st.distanceM)} / ${un.dist(st.straightM)} / ${fmtBearing(st.bearingDeg)}`);
    if (st.altMax) L.push(`${t('st.altMaxGps')}: ${un.alt(st.altMax.v, true)} (${fmtDateTimeUTC(st.altMax.t)})`);
    if (st.vsMax) L.push(`${t('st.vsMax')}: ${un.vs(st.vsMax.v)}`); if (st.vsMin) L.push(`${t('st.vsMin')}: ${un.vs(st.vsMin.v)}`);
    if (st.gsMax) L.push(`${t('st.gsLine')}: ${un.speed(st.gsMax.v)} / ${un.speed(st.gsMean)}`);
    L.push(`${t('st.nightLine')}: ${fmtDurationHM(st.night.totalSec)}`);
    return L.join('\n').replace(/ /g, ' ');
  }

  // ---- reverse geocoding: place names 'CH-Willisau' for take-off, landing and intermediate landings
  // (util/places.js: Nominatim, then Photon as fallback; failures are not cached so «Ortsnamen ermitteln» can retry)
  let geoBusy = false, geoFailed = false;
  async function fetchPlaces(force) {
    const st = state.stats; if (!st || geoBusy) return;
    const at = state.places.at || (state.places.at = {});
    const moved = (k, p) => { const a = at[k]; if (!a) { at[k] = { lat: p.lat, lon: p.lon }; return false; } return Math.hypot(a.lat - p.lat, (a.lon - p.lon) * Math.cos(p.lat * Math.PI / 180)) > 0.003; };   // ≈ 300 m
    const getP = (k, p) => (k === 'inter' ? state.places.inter[p.t] : (moved(k, p) ? null : state.places[k]));
    const setP = (k, p, v) => { if (k === 'inter') state.places.inter[p.t] = v; else { state.places[k] = v; at[k] = { lat: p.lat, lon: p.lon }; } };
    const jobs = [['takeoff', st.takeoff], ['landing', st.landing], ...st.intermediate.map((l) => ['inter', l])].filter(([k, p]) => p && !Number.isNaN(p.lat) && (force || !getP(k, p)));
    for (const [k, p] of jobs) if (k !== 'inter' && state.places[k] && moved(k, p)) { state.places[k] = null; at[k] = { lat: p.lat, lon: p.lon }; }   // stale name of the old position
    if (!jobs.length) return;
    geoBusy = true; geoFailed = false;
    for (const [k, p] of jobs) {
      const name = await reverseGeocode(p.lat, p.lon, document.documentElement.lang || 'de');
      if (name === null) geoFailed = true; else if (name) setP(k, p, name);
    }
    geoBusy = false;
    renderStats(); renderMap(); bus.emit('places');
  }

  const off = bus.on('track', render);
  const off2 = bus.on('events', render), off3 = bus.on('events-filter', render), off4 = bus.on('photos', render);
  const off5 = bus.on('terrain', () => { if (display) { renderProfileCard(); renderLegend(); if (state.terrain && state.terrain.status !== 'loading') render3D(false); } });
  render();
  root.appendChild(el);
  setTimeout(() => map && map.invalidate(), 50);
  if (state.settings.view3d !== false && state.track) setTimeout(() => setView(true), 0);   // 0.9.0: Auswerten opens in 3D
  return { unmount: () => { [...viewers].forEach((v) => v.close()); off(); off2(); off3(); off4(); off5(); evCard.unmount(); phCard.unmount(); map && map.destroy(); map = null; map3d && map3d.destroy(); map3d = null; detailMaps.forEach((m) => m.remove()); detailMaps = []; } };
}

export function analyzeStatus() {
  const st = state.stats; if (!st) return '';
  const un = makeUnits(state.settings.units);
  const from = st.takeoff ? (state.places.takeoff || icaoShort(st.takeoff.lat, st.takeoff.lon)) : '–';
  return tx('ana.status', { title: state.meta.title || `${from} → ${st.landing ? (state.places.landing || icaoShort(st.landing.lat, st.landing.lon)) : '…'}`, dur: fmtDurationHM(st.durationSec), dist: un.dist(st.distanceM) });
}
