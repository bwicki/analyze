// Phase 5 · Speichern/Drucken/Exportieren: 1 save under the PIN, 2 print the report, 3 downloads (GPX, GeoJSON,
// KMZ, CSV as a selection or everything as one ZIP), 4 share (short link, QR, messenger preview), 5 hand-over.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast, copyText, choiceDialog } from '../util/dom.js';
import { fmtInt, fmtBytes, fmtDateTimeUTC } from '../util/format.js';
import { state, bus } from '../state.js';
import { downloadGpx, downloadGeoJson, downloadKmz, downloadCsv, downloadAllZip, estimateSizes, baseName } from '../export/download.js';
import { session, hasServer } from '../session.js';
import { saveCurrentFlight, flightTitle } from '../flightio.js';
import { config } from '../config.js';
import { api } from '../api.js';
import { qrSvg } from '../util/qr.js';
import { openViewer } from './viewer.js';

const FORMATS = ['gpx', 'geojson', 'kmz', 'csv'];

export function mountExport(root, ctx) {
  let step = 10;
  const step_ = (n, title) => `<h2><span class="stepnum">${n}</span>${esc(title)}</h2>`;
  const el = html(`<main class="page">
    <div class="row-wrap" style="align-items:flex-start">
      <div class="col" style="flex:2 1 600px">
        <section class="card step" data-savecard>
          ${step_(1, t('exp.save'))}
          <div data-save></div>
        </section>
        <section class="card step">
          ${step_(2, t('exp.print'))}
          <p class="small muted" style="margin:0">${esc(t('exp.printSub'))}</p>
          <div class="actions"><button class="btn primary" type="button" data-act="print">${esc(t('exp.printBtn'))}</button></div>
        </section>
        <section class="card step">
          ${step_(3, t('exp.download'))}
          <div class="row-wrap" style="gap:12px;align-items:flex-end">
            <label class="f" style="width:300px">${esc(t('exp.resolution'))}<select class="in" data-step><option value="0">${esc(t('exp.res.all'))}</option><option value="10" selected>${esc(t('exp.res.10'))}</option><option value="60">${esc(t('exp.res.60'))}</option></select></label>
            <span class="muted small" data-count></span>
          </div>
          <div class="dl-list" data-cards></div>
          <span class="muted small">${esc(t('exp.nameNote', { name: '' }))}<span class="mono" data-basename></span></span>
          <div class="actions"><span class="muted small" data-dlhint></span><button class="btn primary" type="button" data-act="downloadSelected" disabled>${esc(t('exp.downloadSelected'))}</button></div>
        </section>
      </div>
      <div class="col" style="flex:1 1 340px">
        <section class="card step">
          ${step_(4, t('exp.share'))}
          <p class="small" style="margin:0">${esc(t('exp.shareSub'))}</p>
          <div data-share></div>
        </section>
        <section class="card step">
          ${step_(5, t('exp.handover'))}
          <div class="row"><span>Google Earth</span><button class="btn sm" type="button" data-act="kmz">${esc(t('exp.kmzOpen'))}</button></div>
          <span class="muted small">${esc(t('exp.earthNote'))}</span>
        </section>
      </div>
    </div>
  </main>`);
  const stepSel = el.querySelector('[data-step]');
  stepSel.addEventListener('change', () => { step = +stepSel.value; render(); });
  const selected = { gpx: true, geojson: false, kmz: false, csv: false, zip: false };   // «Alles als ZIP» disables the single formats
  el.addEventListener('change', (e) => { const cb = e.target.closest('[data-fmt]'); if (!cb) return; selected[cb.dataset.fmt] = cb.checked; renderSelection(); });
  const DL = { gpx: () => downloadGpx(step), geojson: () => downloadGeoJson(step), kmz: () => downloadKmz(step || 1), csv: () => downloadCsv(step) };
  onAct(el, {
    kmz: () => downloadKmz(step || 1),
    bigPreview: (img) => { const v = openViewer({ title: esc(t('vw.preview')), sub: esc(flightTitle()) }); const big = document.createElement('img'); big.className = 'big'; big.alt = ''; big.src = img.src; v.body.appendChild(big); },   // 0.9.1
    downloadSelected: async (b) => {
      b.disabled = true;
      try {
        if (selected.zip) { toast(t('exp.zipping')); await downloadAllZip(step); }
        else { const list = FORMATS.filter((f) => selected[f]); for (let k = 0; k < list.length; k++) { if (k) await new Promise((r) => setTimeout(r, 400)); await DL[list[k]](); } }   // one download after another – browsers ask once for several
      } finally { renderSelection(); }
    },
    save: async (b) => {
      b.disabled = true; b.textContent = t('exp.saving');
      try { const rec = await saveCurrentFlight(); toast(t('exp.savedToast', { title: rec.title })); renderSave(); renderShare(); }
      catch (ex) { console.error(ex); toast(ex.status === 413 ? t('exp.quota') : ex.status === 401 ? t('start.errUnknown') : t('start.errNetwork'), true); renderSave(); }
    },
    copy: async () => { if (state.flight && await copyText(state.flight.url)) toast(t('common.copied')); },
    print: async () => {
      // not saved yet (and saving is possible): offer to save first so the print carries short link + QR code
      const canSave = hasServer() && !!session.code && !state.viewer;
      if (canSave && !(state.flight && state.flight.id)) {
        const choice = await choiceDialog({ title: t('exp.printUnsavedTitle'), text: `<p>${esc(t('exp.printUnsavedText'))}</p>`, buttons: [{ id: 'save', label: t('exp.printSaveFirst'), primary: true }, { id: 'print', label: t('exp.printWithout') }, { id: 'cancel', label: t('common.cancel') }] });
        if (!choice || choice === 'cancel') return;
        if (choice === 'save') { try { const rec = await saveCurrentFlight(); toast(t('exp.savedToast', { title: rec.title })); renderSave(); renderShare(); } catch (ex) { console.error(ex); toast(ex.status === 413 ? t('exp.quota') : ex.status === 401 ? t('start.errUnknown') : t('start.errNetwork'), true); return; } }
      } else if (state.flight && state.flight.id && state.flight.public === false) toast(t('exp.printPrivateNote'));
      printReport(ctx);
    },
    toggleVisibility: async () => {
      if (!state.flight) return;
      try { const rec = await api.flights.update(state.flight.id, { public: !state.flight.public }); state.flight.public = rec.public; renderShare(); renderSave(); } catch { toast(t('start.errNetwork'), true); }
    },
    gotoStart: () => ctx.goto('start'),
  });
  /** The printable report lives in step 4: show it and print once the maps have drawn (the user stays there). */
  function printReport(ctx) {
    toast(t('exp.printPreparing'));
    ctx.goto('report');
    setTimeout(() => { try { window.print(); } catch (e) { console.warn('print failed', e); } }, 1400);
  }
  function row(id, ico, title, sub) { return `<label class="dl ${selected.zip && id !== 'zip' ? 'dim' : ''}"><input type="checkbox" data-fmt="${id}" ${selected[id] ? 'checked' : ''} ${selected.zip && id !== 'zip' ? 'disabled' : ''}><span class="ico">${ico}</span><span class="t"><strong>${esc(title)}</strong><span>${sub}</span></span></label>`; }
  function render() {
    const est = estimateSizes(step);
    if (!est) { el.querySelector('[data-cards]').innerHTML = `<p class="muted">${esc(t('cln.noTrack'))}</p>`; return; }
    el.querySelector('[data-count]').textContent = `${fmtInt(est.points)} ${t('exp.points')}`;
    el.querySelector('[data-basename]').textContent = baseName();
    el.querySelector('[data-cards]').innerHTML = [
      row('gpx', 'GPX', t('exp.gpx'), `${esc(t('exp.gpxSub'))} · ≈ ${fmtBytes(est.gpx)}`),
      row('geojson', 'JSON', t('exp.geojson'), `${esc(t('exp.geojsonSub'))} · ≈ ${fmtBytes(est.geojson)}`),
      row('kmz', 'KMZ', t('exp.kmz'), `${esc(t('exp.kmzSub'))} · ≈ ${fmtBytes(est.kmz)}`),
      row('csv', 'CSV', t('exp.csv'), `${esc(t('exp.csvSub'))} · ≈ ${fmtBytes(est.csv)}`),
      row('zip', 'ZIP', t('exp.zip'), esc(t('exp.zipSub'))),
    ].join('');
    renderSelection();
    renderSave(); renderShare();
  }
  /** Checkbox states, the hint and the button label («Alles als ZIP» greys out the single formats). */
  function renderSelection() {
    el.querySelectorAll('[data-fmt]').forEach((cb) => { const f = cb.dataset.fmt; cb.checked = !!selected[f]; if (f !== 'zip') { cb.disabled = selected.zip; cb.closest('.dl').classList.toggle('dim', selected.zip); } });
    const n = selected.zip ? 1 : FORMATS.filter((f) => selected[f]).length;
    const btn = el.querySelector('[data-act=downloadSelected]'); btn.disabled = n === 0;
    btn.textContent = selected.zip ? t('exp.downloadZip') : n > 1 ? t('exp.downloadN', { n }) : t('exp.downloadSelected');
    el.querySelector('[data-dlhint]').textContent = selected.zip ? t('exp.zipHint') : n === 0 ? t('exp.selectHint') : n > 1 ? t('exp.multiHint') : '';
  }
  /** Raw tracker files: what will be stored / what is stored (0.8.7). */
  function rawLine(f) {
    const n = state.rawFiles.length, bytes = state.rawFiles.reduce((a, x) => a + x.size, 0);
    if (state.rawBusy) return t('exp.rawBusy');
    if (f && state.rawUploadedFor === f.id) return n ? t('exp.rawStored', { n, size: fmtBytes(bytes) }) : f.rawFiles ? t('exp.rawStoredN', { n: f.rawFiles, size: fmtBytes(f.rawBytes || 0) }) : t('exp.rawNone');
    return n ? t('exp.rawPending', { n, size: fmtBytes(bytes) }) : t('exp.rawNone');
  }
  function renderSave() {
    const box = el.querySelector('[data-save]');
    if (!hasServer()) { box.innerHTML = `<div class="banner info"><div class="body"><h3>${esc(t('start.noServer'))}</h3></div></div>`; return; }
    if (!session.code) { box.innerHTML = `<div class="banner info"><div class="body"><h3>${esc(t('exp.needCode'))}</h3><div class="sub">${esc(t('exp.needCodeSub'))}</div></div><div class="side"><button class="btn sm" type="button" data-act="gotoStart">${esc(t('exp.toStart'))}</button></div></div>`; return; }
    const f = state.flight, full = estimateSizes(0);
    box.innerHTML = `<div class="row"><span class="k2">${esc(t('rep.title'))}</span><span class="val" style="white-space:normal">${esc(flightTitle())}</span></div>
      <div class="row"><span class="k2">${esc(t('start.code'))}</span><span class="val">${esc(session.code)}${session.me && session.me.displayName ? ` · <span class="sub">${esc(session.me.displayName)}</span>` : ''}</span></div>
      <div class="row"><span class="k2">${esc(t('exp.saveWhat'))}</span><span class="val" style="white-space:normal"><span class="sub">${esc(t('exp.saveWhatSub', { n: fmtInt(full ? full.points : 0) }))}</span></span></div>
      <div class="row"><span class="k2">${esc(t('exp.rawWhat'))}</span><span class="val" style="white-space:normal"><span class="sub">${esc(rawLine(f))}</span></span></div>
      ${f ? `<div class="row"><span class="k2">${esc(t('exp.savedAs'))}</span><span class="val">/v/${esc(f.id)}<br><span class="sub">${esc(t('exp.savedAt'))} ${fmtDateTimeUTC(f.updatedAt)}</span></span></div>` : ''}
      <div class="actions"><span class="muted small">${esc(t('exp.saveNote'))}</span><button class="btn primary" type="button" data-act="save">${esc(f && !state.viewer ? t('exp.saveAgain') : t('exp.saveNow'))}</button></div>`;
  }
  function renderShare() {
    const box = el.querySelector('[data-share]');
    const f = state.flight;
    if (!f) { box.innerHTML = `<label class="f">${esc(t('exp.shortLink'))}<input class="in mono" type="text" readonly value="analyze.wicki.aero/v/…" disabled></label><span class="muted small">${esc(t('exp.shareAfterSave'))}</span>`; return; }
    const url = f.url;
    box.innerHTML = `<label class="f">${esc(t('exp.shortLink'))}<div class="row-wrap" style="gap:8px"><input class="in mono" type="text" readonly value="${esc(url.replace(/^https?:\/\//, ''))}" style="flex:1"><button class="btn" type="button" data-act="copy">${esc(t('exp.copyLink'))}</button></div></label>
      <div class="row-wrap" style="gap:14px;align-items:center"><div class="qr" data-qr></div><div class="col" style="gap:6px;flex:1"><a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('exp.openViewer'))} ↗</a>
        ${state.viewer ? '' : `<button class="btn sm" type="button" data-act="toggleVisibility">${esc(f.public ? t('exp.makePrivate') : t('exp.makePublic'))}</button>`}
        <span class="muted small">${esc(f.public ? t('exp.isPublic') : t('exp.isPrivate'))}</span></div></div>
      ${f.public && config.apiBase ? `<div class="msgpreview" data-msgpreview><div class="muted small">${esc(t('exp.msgPreview'))}</div>${state.previewBusy ? `<div class="msgpreview-busy muted small">${esc(t('exp.msgPreviewBusy'))}</div>` : `<img alt="" src="${esc(`${config.apiBase}/api/view/${f.id}/preview.jpg?v=${f.previewAt || f.updatedAt || 0}`)}" loading="lazy" data-act="bigPreview" style="cursor:zoom-in" title="${esc(t('vw.expand'))}">`}<div class="muted small">${esc(t('exp.msgPreviewSub'))}</div></div>` : ''}`;
    box.querySelector('[data-qr]').innerHTML = qrSvg(url, { size: 132 });
  }
  const off = bus.on('track', render), off2 = bus.on('flight', () => { renderSave(); renderShare(); });
  const off3 = bus.on('preview', () => renderShare());   // image being rendered / uploaded → placeholder, then the picture
  const off4 = bus.on('raw', (d) => { renderSave(); if (d && d.ok === false) toast(d.error === 413 ? t('exp.rawQuota') : t('exp.rawFailed'), true); });
  render();
  root.appendChild(el);
  return { unmount: () => { off(); off2(); off3(); off4(); } };
}
