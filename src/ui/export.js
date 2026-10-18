// Phase 5 · Exportieren: GPX, GeoJSON, KMZ, CSV, ZIP at a chosen resolution; saving under a Kennung and the
// short link are phase 2 (shown disabled so the flow is visible).

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast } from '../util/dom.js';
import { fmtInt, fmtBytes } from '../util/format.js';
import { state, bus } from '../state.js';
import { downloadGpx, downloadGeoJson, downloadKmz, downloadCsv, downloadAllZip, estimateSizes, baseName } from '../export/download.js';

export function mountExport(root, ctx) {
  let step = 10;
  const el = html(`<main class="page">
    <div class="row-wrap" style="align-items:flex-start">
      <div class="col" style="flex:2 1 600px">
        <section class="card">
          <h2>${esc(t('exp.download'))}</h2>
          <div class="row-wrap" style="gap:12px;align-items:flex-end">
            <label class="f" style="width:300px">${esc(t('exp.resolution'))}<select class="in" data-step><option value="0">${esc(t('exp.res.all'))}</option><option value="10" selected>${esc(t('exp.res.10'))}</option><option value="60">${esc(t('exp.res.60'))}</option></select></label>
            <span class="muted small" data-count></span>
          </div>
          <div class="g2" data-cards></div>
          <span class="muted small">${esc(t('exp.nameNote', { name: '' }))}<span class="mono" data-basename></span></span>
        </section>
        <section class="card">
          <h2>${esc(t('exp.save'))}</h2>
          <div class="banner info"><div class="body"><h3>${esc(t('exp.savePhase2'))}</h3><div class="sub">${esc(t('exp.savePhase2Sub'))}</div></div></div>
        </section>
      </div>
      <div class="col" style="flex:1 1 340px">
        <section class="card">
          <h2>${esc(t('exp.share'))}</h2>
          <p class="small">${esc(t('exp.shareSub'))}</p>
          <label class="f">${esc(t('exp.shortLink'))}<input class="in mono" type="text" readonly value="analyze.wicki.aero/v/…" disabled></label>
          <span class="muted small">${esc(t('exp.sharePhase2'))}</span>
        </section>
        <section class="card">
          <h2>${esc(t('exp.handover'))}</h2>
          <div class="row"><span>Google Earth</span><button class="btn sm" type="button" data-act="kmz">${esc(t('exp.kmzOpen'))}</button></div>
          <div class="row"><span>ops.wicki.aero</span><button class="btn sm" type="button" disabled>${esc(t('exp.opsHandover'))}</button></div>
          <span class="muted small">${esc(t('exp.earthNote'))}</span>
        </section>
      </div>
    </div>
  </main>`);
  const stepSel = el.querySelector('[data-step]');
  stepSel.addEventListener('change', () => { step = +stepSel.value; render(); });
  onAct(el, {
    gpx: () => downloadGpx(step), geojson: () => downloadGeoJson(step), kmz: () => downloadKmz(step || 1), csv: () => downloadCsv(step),
    zip: async () => { toast(t('exp.zipping')); await downloadAllZip(step); },
  });
  function card(id, ico, title, sub, cls = '') { return `<div class="exp"><div class="ico">${ico}</div><div class="t"><strong>${esc(title)}</strong><span>${sub}</span></div><button class="btn sm ${cls}" type="button" data-act="${id}">${esc(t('exp.saveBtn'))}</button></div>`; }
  function render() {
    const est = estimateSizes(step);
    if (!est) { el.querySelector('[data-cards]').innerHTML = `<p class="muted">${esc(t('cln.noTrack'))}</p>`; return; }
    el.querySelector('[data-count]').textContent = t('exp.points', { n: fmtInt(est.points) });
    el.querySelector('[data-basename]').textContent = baseName();
    el.querySelector('[data-cards]').innerHTML = [
      card('gpx', 'GPX', t('exp.gpx'), `${esc(t('exp.gpxSub'))} · ≈ ${fmtBytes(est.gpx)}`),
      card('geojson', 'JSON', t('exp.geojson'), `${esc(t('exp.geojsonSub'))} · ≈ ${fmtBytes(est.geojson)}`),
      card('kmz', 'KMZ', t('exp.kmz'), `${esc(t('exp.kmzSub'))} · ≈ ${fmtBytes(est.kmz)}`),
      card('csv', 'CSV', t('exp.csv'), `${esc(t('exp.csvSub'))} · ≈ ${fmtBytes(est.csv)}`),
      card('zip', 'ZIP', t('exp.zip'), esc(t('exp.zipSub'))),
    ].join('');
  }
  const off = bus.on('track', render);
  render();
  root.appendChild(el);
  return { unmount: off };
}
