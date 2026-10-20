// Phase 4 · Bericht: Stammdaten form + printable report (browser print → PDF). Phase 1 scope: one layout,
// logo Wicki Partners Ballonteam, Kennzahlen, map, profile, segments protocol.

import { t } from '../i18n.js';
import { esc, html, onAct } from '../util/dom.js';
import { fmtInt, fmtNum, fmtTimeUTC, fmtDateUTC, fmtDateTimeUTC, fmtDurationHM, fmtBearing, icaoShort, fmtLocalByLon, fmtDayUTC } from '../util/format.js';
import { makeUnits } from '../util/units.js';
import { state, bus, saveMeta, VERSION } from '../state.js';
import { trackPoints, timeMarkers } from '../process/track.js';
import { movingMean, indexAt } from '../process/series.js';
import { createMap, VARIO_COLORS, varioClass } from './map.js';
import { renderProfile } from './profile.js';
import { session, logoUrl, DEFAULT_LOGO } from '../session.js';
import { qrSvg } from '../util/qr.js';
import { eventsForDisplay, ballastSeries, typeLabel } from './events.js';
import { photosForDisplay } from './photos.js';
import { api } from '../api.js';
import { summarizeEvents, EVENT_COLORS } from '../events/log.js';
import { mergeLine } from '../process/mergeinfo.js';
import { terrainForDisplay } from '../terrain/store.js';

const FIELDS = ['title', 'event', 'purpose', 'nvfr', 'balloon', 'type', 'volume', 'equipment', 'pic', 'copilot', 'pax', 'crew', 'commandCenter', 'startName', 'landName', 'remarks'];

export function mountReport(root, ctx) {
  const m = state.meta;
  // defaults of the Kennung (Meine Fahrten → Vorgaben) prefill empty fields of a new flight
  const prefs = (session.me && session.me.prefs) || {};
  if (!state.viewer && !state.flight) { if (!m.balloon && prefs.balloon) m.balloon = prefs.balloon; if (!m.pic && prefs.pic) m.pic = prefs.pic; }
  const el = html(`<main class="page">
    <div class="row-wrap" style="align-items:flex-start">
      <div class="col noprint" style="flex:1 1 380px">
        <section class="card">
          <h2>${esc(t('rep.flight'))}</h2>
          <label class="f">${esc(t('rep.title'))}<input class="in" data-f="title" value="${esc(m.title)}" placeholder="${esc(t('rep.titlePh'))}"></label>
          <div class="g2">
            <label class="f">${esc(t('rep.event'))}<input class="in" data-f="event" value="${esc(m.event)}"></label>
            <label class="f">${esc(t('rep.purpose'))}<select class="in" data-f="purpose">${['private', 'commercial', 'competition', 'training'].map((p) => `<option value="${p}" ${m.purpose === p ? 'selected' : ''}>${esc(t('rep.purpose.' + p))}</option>`).join('')}</select></label>
            <label class="f">${esc(t('rep.startName'))}<input class="in" data-f="startName" value="${esc(m.startName)}" placeholder="${esc(t('rep.autoPh'))}"></label>
            <label class="f">${esc(t('rep.landName'))}<input class="in" data-f="landName" value="${esc(m.landName)}" placeholder="${esc(t('rep.autoPh'))}"></label>
          </div>
        </section>
        <section class="card">
          <h2>${esc(t('rep.balloon'))}</h2>
          <div class="g3">
            <label class="f">${esc(t('rep.reg'))}<input class="in" data-f="balloon" value="${esc(m.balloon)}" placeholder="HB-QWV"></label>
            <label class="f">${esc(t('rep.type'))}<input class="in" data-f="type" value="${esc(m.type)}" placeholder="NL-STU71000"></label>
            <label class="f">${esc(t('rep.volume'))}<input class="in" data-f="volume" value="${esc(m.volume || '')}" placeholder="${esc(t('rep.volumePh'))}"></label>
          </div>
          <label class="f">${esc(t('rep.equipment'))}<textarea class="in" data-f="equipment" placeholder="${esc(t('rep.equipmentPh'))}">${esc(m.equipment || '')}</textarea></label>
        </section>
        <section class="card">
          <h2>${esc(t('rep.crew'))}</h2>
          <div class="g2">
            <label class="f">PIC<input class="in" data-f="pic" value="${esc(m.pic)}"></label>
            <label class="f">${esc(t('rep.copilot'))}<input class="in" data-f="copilot" value="${esc(m.copilot)}"></label>
          </div>
          <label class="f">${esc(t('rep.pax'))}<input class="in" data-f="pax" value="${esc(String(m.pax || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean).join(', '))}" placeholder="${esc(t('rep.crewGroundPh'))}"></label>
          <div class="g2">
            <label class="f">${esc(t('rep.crewGround'))}<input class="in" data-f="crew" value="${esc(m.crew || '')}" placeholder="${esc(t('rep.crewGroundPh'))}"></label>
            <label class="f">${esc(t('rep.commandCenter'))}<input class="in" data-f="commandCenter" value="${esc(m.commandCenter || '')}" placeholder="${esc(t('rep.optional'))}"></label>
          </div>
          <label class="f">NVFR<select class="in" data-f="nvfr"><option value="" ${!m.nvfr ? 'selected' : ''}>${esc(t('rep.nvfrAuto'))}</option><option value="yes" ${m.nvfr === 'yes' ? 'selected' : ''}>${esc(t('common.yes'))}</option><option value="no" ${m.nvfr === 'no' ? 'selected' : ''}>${esc(t('common.no'))}</option></select></label>
        </section>
        <section class="card">
          <h2>${esc(t('rep.remarks'))}</h2>
          <textarea class="in" data-f="remarks" style="min-height:110px">${esc(m.remarks)}</textarea>
        </section>
      </div>
      <div style="flex:1 1 560px;min-width:0;display:flex;flex-direction:column;gap:10px">
        <div class="row-wrap noprint" style="justify-content:space-between;align-items:center"><span class="muted small">${esc(t('rep.previewNote'))}</span><button class="btn primary" type="button" data-act="print">${esc(t('rep.print'))}</button></div>
        <article class="report" data-report></article>
      </div>
    </div>
  </main>`);

  el.querySelectorAll('[data-f]').forEach((inp) => { if (state.viewer) inp.disabled = true; inp.addEventListener('input', () => { state.meta[inp.dataset.f] = inp.value; saveMeta(); renderReport(); }); });
  onAct(el, { print: () => window.print() });
  let map = null, mapEl = null, detailMaps = [];

  function renderReport() {
    const st = state.stats, un = makeUnits(state.settings.units), m = state.meta, rep = el.querySelector('[data-report]');
    if (!st) { rep.innerHTML = `<p class="muted">${esc(t('cln.noTrack'))}</p>`; return; }
    const startPlace = m.startName || state.places.takeoff || '', landPlace = m.landName || (st.landing ? state.places.landing : '') || '';
    const startName = startPlace || icaoShort(st.takeoff.lat, st.takeoff.lon);
    const landName = landPlace || (st.landing ? icaoShort(st.landing.lat, st.landing.lon) : '–');
    const placeNote = (place, p) => (place ? `${esc(place)} · ${icaoShort(p.lat, p.lon)}` : icaoShort(p.lat, p.lon));
    const title = m.title || `${t('rep.defaultTitle')} ${fmtDateUTC(st.takeoff.t)}${m.balloon ? ' · ' + m.balloon : ''}`;
    const nvfr = m.nvfr === 'yes' || (m.nvfr === '' && st.night.totalSec > 60);
    const tr = (k, v, note = '', wrap = false) => `<tr><td class="lbl">${esc(k)}</td><td class="v">${v}</td><td class="muted note${wrap ? ' wrap' : ''}">${note}</td></tr>`;
    const interNote = st.intermediate.length ? st.intermediate.map((l) => `${fmtTimeUTC(l.t)} ${esc(state.places.inter[l.t] || icaoShort(l.lat, l.lon))}`).join(' · ') : esc(t('st.noIntermediate'));
    const files = [...new Set(state.files.filter((f) => f.profile).map((f) => f.profile.name))].join(', ');
    rep.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
        <div><div class="pk">${esc(t('rep.kicker'))}</div><h1>${esc(title)}</h1><div class="muted" style="font-size:14px">${esc(m.balloon ? m.balloon + ' · ' : '')}${esc(startName)} → ${esc(landName)} · ${fmtDateUTC(st.takeoff.t)}${st.landing && fmtDateUTC(st.landing.t) !== fmtDateUTC(st.takeoff.t) ? ' – ' + fmtDateUTC(st.landing.t) : ''}</div></div>
        <img src="${esc(state.viewer && state.viewer.owner ? logoUrl(state.viewer.owner.code, state.viewer.owner.logo) : logoUrl(session.code, session.me && session.me.logo))}" alt="Logo" style="height:46px;width:auto;max-width:220px;object-fit:contain" onerror="this.onerror=null;this.src='${DEFAULT_LOGO}'">
      </div>
      <div class="bar"></div>
      <h2 style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${esc(t('rep.master'))}</h2>
      <div class="g2" style="gap:6px 20px;font-size:13px">
        <div><div class="pk">${esc(t('rep.balloon'))}</div>${esc([m.balloon, m.type, m.volume].filter(Boolean).join(' · ') || '–')}</div>
        <div><div class="pk">${esc(t('rep.purpose'))} · NVFR</div>${esc(t('rep.purpose.' + (m.purpose || 'private')))} · ${nvfr ? esc(t('common.yes')) : esc(t('common.no'))}</div>
        <div><div class="pk">PIC</div>${esc(m.pic || '–')}</div>
        <div><div class="pk">${esc(t('rep.copilot'))}</div>${esc(m.copilot || '–')}</div>
        <div><div class="pk">${esc(t('rep.pax'))}</div>${esc(m.pax ? m.pax.split(/[\n,]/).map((x) => x.trim()).filter(Boolean).join(', ') : t('rep.none'))}</div>
        <div><div class="pk">${esc(t('rep.event'))}</div>${esc(m.event || '–')}</div>
        <div><div class="pk">${esc(t('rep.crewGround'))}</div>${esc(m.crew || '–')}</div>
        ${m.commandCenter ? `<div><div class="pk">${esc(t('rep.commandCenter'))}</div>${esc(m.commandCenter)}</div>` : ''}
        ${m.equipment ? `<div style="grid-column:1 / -1"><div class="pk">${esc(t('rep.equipment'))}</div><span style="white-space:pre-line">${esc(m.equipment)}</span></div>` : ''}
      </div>
      <h2 style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${esc(t('ana.stats'))}</h2>
      <table class="stats"><colgroup><col style="width:24%"><col style="width:40%"><col style="width:36%"></colgroup>
        ${tr(t('st.takeoff'), `${fmtDateTimeUTC(st.takeoff.t)} (${fmtLocalByLon(st.takeoff.t, st.takeoff.lon).replace(' (', ' ').replace(')', '')})`, placeNote(startPlace, st.takeoff))}
        ${st.landing ? tr(t('st.landingAt'), `${fmtDateTimeUTC(st.landing.t)} (${fmtLocalByLon(st.landing.t, st.landing.lon).replace(' (', ' ').replace(')', '')})`, placeNote(landPlace, st.landing))
          : (st.endFix ? tr(t('st.landingAt'), `${fmtDateTimeUTC(st.endFix.t)} (${fmtLocalByLon(st.endFix.t, st.endFix.lon).replace(' (', ' ').replace(')', '')})`, `${esc(t('st.noLandingNote'))} · ${icaoShort(st.endFix.lat, st.endFix.lon)}`, true) : '')}
        ${tr(t('st.durationLandings'), `${fmtDurationHM(st.durationSec)} · ${st.landings}`, interNote, st.intermediate.length > 0)}
        ${tr(t('st.distanceLine'), `${un.dist(st.distanceM)} · ${un.dist(st.straightM)} · ${fmtBearing(st.bearingDeg)}`)}
        ${tr(t('st.altMaxGps'), st.altMax ? un.alt(st.altMax.v, true) : '–', st.altMax ? fmtDateTimeUTC(st.altMax.t) : '')}
        ${st.baroMax ? tr(t('st.altMaxBaro'), un.alt(st.baroMax.v, true), 'QNE 1013.25') : ''}
        ${tr(t('st.altMean'), un.alt(st.altMean, true))}
        ${tr(t('st.vs'), `${st.vsMax ? un.vs(st.vsMax.v) : '–'} · ${st.vsMin ? un.vs(st.vsMin.v) : '–'}`, esc(t('st.vs30')))}
        ${tr(t('st.gsLine'), `${st.gsMax ? un.speed(st.gsMax.v) : '–'} · ${un.speed(st.gsMean)}`)}
        ${tr(t('st.accV'), st.accVertMax ? un.acc(st.accVertMax.v) : '–', esc(t('st.accDerived')))}
        ${tr(t('st.touchdown'), st.touchdown.length ? st.touchdown.map((x) => un.vs(x.vs)).join(' · ') : '–')}
        ${tr(t('st.nightLine'), fmtDurationHM(st.night.totalSec), st.night.intervals.map((iv, k) => `${esc(t('st.nightN1', { n: k + 1 }))} ${fmtTimeUTC(iv.from)}–${fmtTimeUTC(iv.to)} UTC`).join(' · ') + ' · ' + esc(t('st.civil')), true)}
        ${tr(t('rep.source'), esc(files || '–'), esc(t('rep.sourceSub', { files: state.segments.filter((s) => s.status === 'use').length, restarts: st.restarts, points: fmtInt(st.nPoints) })), true)}
      </table>
      ${m.remarks ? `<h2 style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${esc(t('rep.remarks'))}</h2><div style="font-size:13px;white-space:pre-line">${esc(m.remarks)}</div>` : ''}
      <div class="foot"><span>analyze.wicki.aero v${VERSION} · ${esc(t('rep.generated'))} ${fmtDateTimeUTC(Date.now())}${state.flight ? ` · ${esc(state.flight.url.replace(/^https?:\/\//, ''))}` : ''}</span><span></span></div>
      <div style="break-before:page"></div>
      <h2 style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:8px">${esc(t('ana.map'))} · ${esc(t('rep.mapSub', { min: state.settings.markerMin }))}</h2>
      <div class="map" data-repmap style="height:360px;min-height:0;flex:none"></div>
      <div class="muted" style="font-size:11px">${esc(t('ana.mapLegend'))} · © OpenStreetMap</div>
      <div class="rep-detail">
        <div><div class="pk">${esc(t('wp.takeoff'))} · ${esc(startName)} · ${fmtDateTimeUTC(st.takeoff.t)}</div><div class="map" data-repstart style="height:200px;min-height:0;flex:none"></div></div>
        ${(st.landing || st.endFix) ? `<div><div class="pk">${esc(st.landing ? t('wp.landing') : t('st.endOfRecording'))} · ${esc(landName)} · ${fmtDateTimeUTC((st.landing || st.endFix).t)}</div><div class="map" data-repland style="height:200px;min-height:0;flex:none"></div></div>` : ''}
      </div>
      <div style="break-inside:avoid"><h2 style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${esc(t('ana.profile'))}</h2>
      <div data-repprofile></div>
      <div class="muted" style="font-size:11px">${esc(t('rep.profileLegend'))}</div></div>
      <div style="break-inside:avoid"><h2 style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">${esc(t('cln.segments'))} · ${esc(t('cln.protocol'))}</h2>
      <table><thead><tr><th>#</th><th>${esc(t('imp.col.file'))}</th><th>${esc(t('cln.col.from'))}</th><th>${esc(t('cln.col.to'))}</th><th class="r">${esc(t('imp.col.points'))}</th></tr></thead>
        ${state.segments.filter((s) => s.status === 'use').map((s) => `<tr><td class="v">${s.id}</td><td class="v">${esc(s.file)}</td><td class="v">${fmtDateUTC(s.t0)} ${fmtTimeUTC(s.t0, true)}</td><td class="v">${fmtDateUTC(s.t1)} ${fmtTimeUTC(s.t1, true)}</td><td class="v" style="text-align:right">${fmtInt(s.n)}</td></tr>`).join('')}</table>
      <div style="font-size:12px">${esc(t('rep.protocolLine', { from: fmtDateTimeUTC(state.trim.from, true), to: fmtDateTimeUTC(state.trim.to, true), auto: state.trim.auto ? t('rep.autoTrim', { sec: state.settings.detect.trimReserveSec }) : t('rep.manualTrim'), restarts: st.restarts, collapsed: fmtInt(state.track.collapsed), masked: fmtInt(st.altMasked), gaps: st.gaps.length, win: state.settings.detect.windowSec, gs: (state.settings.detect.gsAir / 0.514444).toFixed(1), vs: state.settings.detect.vsAir }))}${mergeLine(state.track) ? ` ${esc(mergeLine(state.track))}` : ''}</div></div>
      ${eventsSection()}
      ${photosSection()}
      <div class="sigblock"><div class="sig"><div>${esc(t('rep.sigPic'))}</div><div>${esc(t('rep.sigDate'))}</div></div>
      ${state.flight && state.flight.public !== false ? `<div class="qrline">${qrSvg(state.flight.url, { size: 84 })}<span>${esc(t('rep.qrNote'))}<br><span class="mono">${esc(state.flight.url.replace(/^https?:\/\//, ''))}</span></span></div>` : ''}
      <div class="foot"><span>analyze.wicki.aero v${VERSION} · ${esc(t('rep.generated'))} ${fmtDateTimeUTC(Date.now())}</span><span>${state.flight ? esc(state.flight.url.replace(/^https?:\/\//, '')) : ''}</span></div></div>`;
    // map + profile (static)
    const s = state; const dur = (s.trim.to - s.trim.from) / 1000; const step = Math.max(1, Math.ceil(dur / 1500));
    const pts = trackPoints(s.track, s.series, s.trim, step); const vsS = movingMean(s.track.points.t, s.series.vs, Math.max(15, step / 2));
    for (const q of pts) { q.vsS = vsS[q.i]; q.cls = varioClass(q.vsS); }
    const markers = timeMarkers(s.track, s.series, s.trim.from, s.trim.to, s.settings.markerMin).map((x) => ({ ...x, dist: s.series.dist[x.i] }));
    const mk = (e) => (e ? { t: e.t, lat: e.lat, lon: e.lon, alt: e.alt, dist: s.series.dist[e.idx] } : null);
    const data = { pts, markers, colors: VARIO_COLORS, takeoff: mk(st.takeoff), landing: mk(st.landing), intermediate: st.intermediate.map((l) => ({ lat: l.lat, lon: l.lon, name: state.places.inter[l.t] || '' })), night: st.night.intervals, altMax: st.altMax ? { t: st.altMax.t, alt: st.altMax.v, dist: s.series.dist[indexAt(s.track.points.t, st.altMax.t)] } : null, events: [...eventsForDisplay(), ...photosForDisplay()], ballast: ballastSeries() };
    if (map) { map.destroy(); map = null; }
    detailMaps.forEach((d) => d.remove()); detailMaps = [];
    mapEl = rep.querySelector('[data-repmap]');
    // detail maps (zoom 13) around take-off and landing / end of recording, with a short piece of the track
    const detail = (sel, p, color) => { try { detailMap(sel, p, color); } catch (e) { console.warn('detail map', e); } };
    const detailMap = (sel, p, color) => {
      const dEl = rep.querySelector(sel); if (!dEl || !p || typeof L === 'undefined') return;
      const dm = L.map(dEl, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, attributionControl: false, preferCanvas: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(dm);
      const near = pts.filter((q) => q.fix && Math.abs(q.t - p.t) < 45 * 60000).map((q) => [q.lat, q.lon]);
      if (near.length > 1) L.polyline(near, { color: '#1f5fbf', weight: 3, opacity: 0.9 }).addTo(dm);
      L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(dm);
      dm.setView([p.lat, p.lon], 13);
      setTimeout(() => dm.invalidateSize(), 120);
      detailMaps.push(dm);
    };
    map = createMap(mapEl, { layer: 'osm' });
    detail('[data-repstart]', st.takeoff, '#1f8a4c'); detail('[data-repland]', st.landing || st.endFix, st.landing ? '#c0392b' : '#d98c00');
    if (map) { map.map.dragging.disable(); map.map.scrollWheelZoom.disable(); map.setTrack({ ...data, labelEvery: 3, takeoffLabel: `${t('wp.takeoff')} ${fmtTimeUTC(st.takeoff.t)}`, landingLabel: st.landing ? `${t('wp.landing')} ${fmtTimeUTC(st.landing.t)}` : '', intermediateLabel: t('wp.intermediate') }); setTimeout(() => map && map.invalidate(), 80); }
    renderProfile(rep.querySelector('[data-repprofile]'), { ...data, xMode: 'time', units: un, terrain: terrainForDisplay('time'), labels: { max: t('ana.max'), night: t('ana.night'), takeoff: t('wp.takeoff'), landing: t('wp.landing'), gs: t('ana.gs'), ballast: t('ev.type.Ballast'), aria: t('ana.profile') } });
  }

  /** Photos page: thumbnails with time and position (when the flight has photos). */
  function photosSection() {
    const ph = (state.photosPlaced || []).filter((p) => !Number.isNaN(p.t)).slice(0, 24);
    if (!ph.length) return '';
    return `<div style="break-before:page"></div>
      <h2 style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:8px">${esc(t('ph.title'))} · ${ph.length}${(state.photosPlaced || []).length > ph.length ? ` ${esc(t('ph.ofTotal', { n: (state.photosPlaced || []).length }))}` : ''}</h2>
      <div class="rep-photos">${ph.map((p) => `<figure><img src="${esc(api.photos.url(p.id, true))}" alt=""><figcaption><span class="mono">${fmtDayUTC(p.t)} ${fmtTimeUTC(p.t)} UTC</span>${p.onTrack ? ` · ${icaoShort(p.lat, p.lon)}` : ''}${p.caption ? `<br>${esc(p.caption)}` : ''}</figcaption></figure>`).join('')}</div>`;
  }

  /** Page 3: Ereignislog table (when linked). */
  function eventsSection() {
    const lg = state.evlog; if (!lg || !lg.linked || !lg.linked.length) return '';
    const sm = summarizeEvents(lg.events), un = makeUnits(state.settings.units);
    const rows = lg.linked.filter((e) => e.inTrim);
    const src = lg.source.kind === 'repo' || lg.source.kind === 'saved' ? lg.source.name || lg.source.flight : lg.source.name;
    const summary = [t('ev.linkedCount', { n: rows.length, total: lg.events.length }), ...Object.entries(sm.counts).map(([k, v]) => `${typeLabel(k)} ${v}`), sm.ballastStart !== null ? t('ev.ballast', { from: fmtInt(sm.ballastStart), to: fmtInt(sm.ballastEnd), drops: sm.drops }) : ''].filter(Boolean).join(' · ');
    return `<div style="break-before:page"></div>
      <h2 style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:8px">${esc(t('ana.events'))} · ${esc(src)}</h2>
      <div style="font-size:12px">${esc(summary)}</div>
      <table><thead><tr><th>${esc(t('ev.col.time'))}</th><th>${esc(t('ev.col.type'))}</th><th>${esc(t('ev.col.pos'))}</th><th>${esc(t('ana.r.alt'))}</th><th>${esc(t('ev.col.text'))}</th></tr></thead>
        ${rows.map((e) => `<tr><td class="v">${fmtDayUTC(e.t)} ${fmtTimeUTC(e.t)}</td><td><span style="color:${EVENT_COLORS[e.type]};font-weight:600">${esc(typeLabel(e.type))}</span></td><td class="v">${!Number.isNaN(e.lat) ? icaoShort(e.lat, e.lon) : '–'}${e.place ? `<br><span class="muted">${esc(e.place)}</span>` : ''}</td><td class="v">${!Number.isNaN(e.alt) ? un.alt(e.alt) : '–'}</td><td>${esc(e.text)}${e.reporter ? ` <span class="muted">· ${esc(e.reporter)}</span>` : ''}</td></tr>`).join('')}</table>
      `;
  }

  const off = bus.on('track', renderReport), off2 = bus.on('places', renderReport), off3 = bus.on('events', renderReport), off4 = bus.on('photos', renderReport);
  let terrTimer = null; const off5 = bus.on('terrain', () => { if (state.terrain && state.terrain.status === 'ready') { clearTimeout(terrTimer); terrTimer = setTimeout(renderReport, 300); } });
  renderReport();
  root.appendChild(el);
  return { unmount: () => { off(); off2(); off3(); off4(); off5(); map && map.destroy(); detailMaps.forEach((d) => d.remove()); } };
}
