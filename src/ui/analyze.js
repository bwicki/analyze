// Phase 3 · Auswerten: tiles, map, Kennzahlen, Höhenprofil (coupled hover), place names, events placeholder.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast, copyText } from '../util/dom.js';
import { fmtInt, fmtNum, fmtTimeUTC, fmtDateTimeUTC, fmtDurationHM, fmtDurationClock, fmtBearing, icaoShort, fmtLocalByLon, fmtDayUTC } from '../util/format.js';
import { makeUnits } from '../util/units.js';
import { state, bus, ignoreLanding } from '../state.js';
import { trackPoints, timeMarkers } from '../process/track.js';
import { movingMean, indexAt } from '../process/series.js';
import { createMap, VARIO_COLORS, GS_COLORS, GS_LIMITS_KT, varioClass, gsClass } from './map.js';
import { renderProfile } from './profile.js';
import { downloadKmz } from '../export/download.js';
import { reverseGeocode } from '../util/places.js';
import { terrainForDisplay, groundAt } from '../terrain/store.js';
import { mountEventsCard, eventsForDisplay, ballastSeries } from './events.js';
import { mountPhotosCard, photosForDisplay } from './photos.js';

const DISPLAY_MAX = 3000;

export function mountAnalyze(root, ctx) {
  const el = html(`<main class="page">
    <div class="tiles" data-tiles></div>
    <div class="row-wrap">
      <section class="card" style="flex:2 1 620px">
        <div class="card-head"><h2>${esc(t('ana.map'))}</h2><div class="row-wrap noprint" style="gap:8px;align-items:center">
          <div class="seg" data-color><button type="button" data-c="vario">${esc(t('ana.color.vario'))}</button><button type="button" data-c="gs">${esc(t('ana.color.gs'))}</button></div>
          <select class="in sm" data-marker style="width:auto"><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option><option value="180">3 h</option></select>
        </div></div>
        <div class="map" data-map></div>
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
        <div class="seg" data-xmode><button type="button" data-x="time">${esc(t('ana.x.time'))}</button><button type="button" data-x="dist">${esc(t('ana.x.dist'))}</button></div>
      </div></div>
      <div class="readout" data-readout><span class="muted">${esc(t('ana.readoutHint'))}</span></div>
      <div data-profile></div>
      <div class="legend" data-legend></div>
    </section>
    <div data-eventscard style="display:contents"></div>
    <div data-photoscard style="display:contents"></div>
  </main>`);

  const mapEl = el.querySelector('[data-map]');
  let map = null, profile = null, display = null, xMode = 'time', pinned = null;
  const evCard = mountEventsCard(el.querySelector('[data-eventscard]'), { onSelect: (e) => { const q = e && !Number.isNaN(e.lat) ? { t: e.t, lat: e.lat, lon: e.lon, alt: e.alt, dist: e.dist, vsS: NaN, gs: NaN, fix: true } : null; map && map.setHover(q); profile && profile.setHover(q); readout(q || pinned); } });
  // click on the map or the profile pins a moment on both (hover stays transient)
  function pin(q) { pinned = q && q.fix ? q : null; map && map.setPinned(pinned); profile && profile.setPinned(pinned); readout(pinned); }
  const phCard = mountPhotosCard(el.querySelector('[data-photoscard]'), { goto: (p) => ctx.goto(p), getPinned: () => pinned, onSelect: (p) => { const q = p && p.onTrack ? { t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, dist: p.dist, vsS: NaN, gs: NaN, fix: true } : null; map && map.setHover(q); profile && profile.setHover(q); readout(q || pinned); } });
  const shownEvents = () => [...eventsForDisplay().filter((e) => !evCard.hidden.has(e.type)), ...photosForDisplay()];
  const u = () => makeUnits(state.settings.units);

  const segBtns = (sel, attr, value) => el.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset[attr] === value));
  el.querySelectorAll('[data-color] button').forEach((b) => b.addEventListener('click', () => { state.settings.colorBy = b.dataset.c; ctx.saveSettings(); render(); }));
  el.querySelectorAll('[data-xmode] button').forEach((b) => b.addEventListener('click', () => { xMode = b.dataset.x; renderProfileCard(); segBtns('[data-xmode]', 'x', xMode); }));
  const markerSel = el.querySelector('[data-marker]'); markerSel.value = String(state.settings.markerMin);
  markerSel.addEventListener('change', () => { state.settings.markerMin = +markerSel.value; ctx.saveSettings(); render(); });
  onAct(el, {
    kmz: () => downloadKmz(10),
    copy: async () => { const txt = statsText(); if (await copyText(txt)) toast(t('common.copied')); },
    units: (b) => { state.settings.units = b.dataset.u; ctx.saveSettings(); render(); },
    geocode: () => fetchPlaces(true),
    ignore: (b) => { ignoreLanding(+b.dataset.t); toast(t('ana.landingIgnored')); },
  });

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
    const markers = timeMarkers(s.track, s.series, s.trim.from, s.trim.to, s.settings.markerMin).map((m) => ({ ...m, dist: s.series.dist[m.i] }));
    const st = s.stats;
    const mk = (e) => (e ? { t: e.t, lat: e.lat, lon: e.lon, alt: e.alt, dist: s.series.dist[e.idx] } : null);
    const altMax = st.altMax ? { t: st.altMax.t, alt: st.altMax.v, dist: s.series.dist[indexAt(s.track.points.t, st.altMax.t)] } : null;
    return { pts, markers, step, colors: colorBy === 'gs' ? GS_COLORS : VARIO_COLORS, takeoff: mk(st.takeoff), landing: mk(st.landing), intermediate: st.intermediate.map((l) => ({ lat: l.lat, lon: l.lon, t: l.t, name: state.places.inter[l.t] || '' })), altMax, night: st.night.intervals, events: shownEvents(), ballast: ballastSeries() };
  }

  function render() {
    display = buildDisplay();
    segBtns('[data-color]', 'c', state.settings.colorBy === 'gs' ? 'gs' : 'vario'); segBtns('[data-xmode]', 'x', xMode);
    renderTiles(); renderStats(); renderMap(); renderProfileCard(); renderLegend();
    if (state.settings.geocode) fetchPlaces(false);
  }

  function renderMap() {
    if (!display) return;
    if (!map) {
      map = createMap(mapEl, { layer: state.settings.mapLayer, layerLabels: { osm: t('ana.layer.osm'), topo: t('ana.layer.topo'), sat: t('ana.layer.sat') } }); if (!map) return;
      map.onHover((q) => { profile && profile.setHover(q); readout(q || pinned); }); map.onClick((q) => pin(q));
      map.onLayerChange((k) => { state.settings.mapLayer = k; ctx.saveSettings(); });
    }
    const every = state.settings.markerMin >= 180 ? 1 : state.settings.markerMin >= 60 ? 3 : state.settings.markerMin >= 30 ? 6 : 12;
    map.setTrack({ ...display, labelEvery: every, takeoffLabel: `${t('wp.takeoff')} ${fmtTimeUTC(display.takeoff ? display.takeoff.t : 0)} UTC`, landingLabel: `${t('wp.landing')} ${fmtTimeUTC(display.landing ? display.landing.t : 0)} UTC`, intermediateLabel: t('wp.intermediate'), ignoreLabel: t('ana.ignoreLanding'), onIgnoreIntermediate: state.viewer ? null : (ms) => { ignoreLanding(ms); toast(t('ana.landingIgnored')); } });
    if (pinned) map.setPinned(pinned);
    const st = state.stats;
    const gm = (p) => (p && !Number.isNaN(p.lat) ? `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lon.toFixed(6)}` : '#');
    el.querySelector('[data-gm-start]').href = gm(st.takeoff); el.querySelector('[data-gm-land]').href = gm(st.landing);
  }

  function renderProfileCard() {
    if (!display) return;
    const un = u();
    profile = renderProfile(el.querySelector('[data-profile]'), { ...display, xMode, units: un, pinned, terrain: terrainForDisplay(xMode), labels: { max: t('ana.max'), night: t('ana.night'), takeoff: t('wp.takeoff'), landing: t('wp.landing'), gs: t('ana.gs'), ballast: t('ev.type.Ballast'), aria: t('ana.profile') }, onHover: (q) => { map && map.setHover(q); readout(q || pinned); }, onClick: (q) => pin(q) });
  }

  function readout(q) {
    const r = el.querySelector('[data-readout]'); const un = u();
    if (!q) { r.innerHTML = `<span class="muted">${esc(t('ana.readoutHint'))}</span>`; return; }
    r.innerHTML = `<span>${esc(t('ana.r.time'))} <b>${fmtDayUTC(q.t)} ${fmtTimeUTC(q.t, true)} UTC</b></span><span>${esc(t('ana.r.alt'))} <b>${un.alt(q.alt, true)}</b></span><span>${esc(t('ana.r.vs'))} <b>${un.vs(q.vsS)}</b></span><span>${esc(t('ana.r.gs'))} <b>${un.speed(q.gs, 1)}</b></span><span>${esc(t('ana.r.pos'))} <b>${icaoShort(q.lat, q.lon)}</b></span><span>${esc(t('ana.r.dist'))} <b>${un.dist(q.dist - display.pts[0].dist)}</b></span>${Number.isFinite(groundAt(q.i)) ? `<span>${esc(t('ana.r.agl'))} <b>${un.alt(Math.max(0, q.alt - groundAt(q.i)))}</b></span>` : ''}`;
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

  function renderTiles() {
    const st = state.stats, un = u();
    const tile = (k, v, unit, sub) => `<div class="tile"><span class="k">${esc(k)}</span><span class="v">${v}<small>${esc(unit)}</small></span><span class="u">${sub}</span></div>`;
    const noUnit = (str) => String(str).replace(/[\s\u00a0]*(km\/h|m\/s|km|ft|kt|m)$/, '');
    el.querySelector('[data-tiles]').innerHTML = [
      tile(t('st.duration'), fmtDurationClock(st.durationSec), 'h:min', `${st.landings} ${esc(t(st.landings === 1 ? 'st.landing1' : 'st.landingN'))}`),
      tile(t('st.distance'), noUnit(un.dist(st.distanceM)), 'km', `${un.dist(st.straightM)} ${esc(t('st.straightShort'))}`),
      tile(t('st.altMax'), st.altMax ? noUnit(un.alt(st.altMax.v)) : '–', un.altUnit, st.altMax ? fmtTimeUTC(st.altMax.t) + ' UTC' : ''),
      tile(t('st.vs'), `<span style="font-size:20px">${st.vsMax ? noUnit(un.vs(st.vsMax.v)) : '–'} / ${st.vsMin ? noUnit(un.vs(st.vsMin.v)) : '–'}</span>`, 'm/s', esc(t('st.vsSub'))),
      tile(t('st.gs'), `${st.gsMax ? fmtNum(un.speedValue(st.gsMax.v), 0) : '–'} / ${fmtNum(un.speedValue(st.gsMean), 0)}`, un.speedUnit, esc(t('st.gsSub'))),
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
      ${row(t('st.takeoff'), st.takeoff ? fmtDateTimeUTC(st.takeoff.t) : '–', st.takeoff ? `${fmtLocalByLon(st.takeoff.t, st.takeoff.lon)} · ${placeLine('takeoff', st.takeoff)}` : '')}
      ${row(t('st.landingAt'), st.landing ? fmtDateTimeUTC(st.landing.t) : (st.endFix ? fmtDateTimeUTC(st.endFix.t) : '–'), st.landing ? `${fmtLocalByLon(st.landing.t, st.landing.lon)} · ${placeLine('landing', st.landing)}` : (st.endFix ? `<span class="err">${esc(t('st.noLandingNote'))}</span> · ${icaoShort(st.endFix.lat, st.endFix.lon)}` : ''))}
      ${row(t('st.landings'), `${st.landings}`, st.intermediate.length ? st.intermediate.map((l) => `<span class="inter">${fmtTimeUTC(l.t)} UTC · ${esc(state.places.inter[l.t] || icaoShort(l.lat, l.lon))} (${fmtDurationHM(l.groundSec || 0)})${state.viewer ? '' : ` <button type="button" class="tt-x inline noprint" data-act="ignore" data-t="${l.t}" title="${esc(t('ana.ignoreLanding'))}">×</button>`}</span>`).join('<br>') + (state.ignoredLandings.length ? `<br><span class="muted">${esc(t('ana.ignoredCount', { n: state.ignoredLandings.length }))}</span>` : '') : esc(t('st.noIntermediate')) + (state.ignoredLandings.length ? ` · ${esc(t('ana.ignoredCount', { n: state.ignoredLandings.length }))}` : ''))}
      ${row(t('st.duration'), `<span class="big">${fmtDurationHM(st.durationSec)}</span>`, st.intermediate.length ? esc(t('st.airtime', { v: fmtDurationHM(st.airSec) })) : '')}
      ${row(t('st.distanceLine'), `${un.dist(st.distanceM)} · ${un.dist(st.straightM)} · ${fmtBearing(st.bearingDeg)}`)}
      ${row(t('st.altMaxGps'), st.altMax ? un.alt(st.altMax.v, true) : '–', st.altMax ? `${fmtDateTimeUTC(st.altMax.t)}` : '')}
      ${st.baroMax ? row(t('st.altMaxBaro'), un.alt(st.baroMax.v, true)) : ''}
      ${row(t('st.altMean'), un.alt(st.altMean, true))}
      ${row(t('st.vsMax'), st.vsMax ? un.vs(st.vsMax.v) : '–', st.vsMax ? `${fmtDateTimeUTC(st.vsMax.t)} · ${esc(t('st.vs30'))}` : '')}
      ${row(t('st.vsMin'), st.vsMin ? un.vs(st.vsMin.v) : '–', st.vsMin ? `${fmtDateTimeUTC(st.vsMin.t)} · ${esc(t('st.vs30'))}` : '')}
      ${row(t('st.gsLine'), `${st.gsMax ? un.speed(st.gsMax.v) : '–'} · ${un.speed(st.gsMean)}`, esc(t('st.gsSub2')))}
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
    const getP = (k, p) => (k === 'inter' ? state.places.inter[p.t] : state.places[k]);
    const setP = (k, p, v) => { if (k === 'inter') state.places.inter[p.t] = v; else state.places[k] = v; };
    const jobs = [['takeoff', st.takeoff], ['landing', st.landing], ...st.intermediate.map((l) => ['inter', l])].filter(([k, p]) => p && !Number.isNaN(p.lat) && (force || !getP(k, p)));
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
  const off5 = bus.on('terrain', () => { if (display) { renderProfileCard(); renderLegend(); } });
  render();
  root.appendChild(el);
  setTimeout(() => map && map.invalidate(), 50);
  return { unmount: () => { off(); off2(); off3(); off4(); off5(); evCard.unmount(); phCard.unmount(); map && map.destroy(); map = null; } };
}

export function analyzeStatus() {
  const st = state.stats; if (!st) return '';
  const un = makeUnits(state.settings.units);
  return tx('ana.status', { title: state.meta.title || `${state.places.takeoff || icaoShort(st.takeoff.lat, st.takeoff.lon)} → ${st.landing ? (state.places.landing || icaoShort(st.landing.lat, st.landing.lon)) : '…'}`, dur: fmtDurationHM(st.durationSec), dist: un.dist(st.distanceM) });
}
