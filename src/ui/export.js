// Phase 5 · Exportieren: GPX, GeoJSON, KMZ, CSV, ZIP at a chosen resolution; saving under the Kennung
// (phase 2) with short link and QR code for the public viewer.

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

export function mountExport(root, ctx) {
  let step = 10;
  const el = html(`<main class="page">
    <div class="row-wrap" style="align-items:flex-start">
      <div class="col" style="flex:2 1 600px">
        <section class="card" data-savecard>
          <h2>${esc(t('exp.save'))}</h2>
          <div data-save></div>
        </section>
        <section class="card">
          <h2>${esc(t('exp.print'))}</h2>
          <div class="row-wrap" style="gap:12px;align-items:center;justify-content:space-between"><span class="muted small" style="flex:1 1 320px" data-printnote>${esc(t('exp.printSub'))}</span><button class="btn primary" type="button" data-act="print">${esc(t('exp.printBtn'))}</button></div>
        </section>
        <section class="card">
          <h2>${esc(t('exp.download'))}</h2>
          <div class="row-wrap" style="gap:12px;align-items:flex-end">
            <label class="f" style="width:300px">${esc(t('exp.resolution'))}<select class="in" data-step><option value="0">${esc(t('exp.res.all'))}</option><option value="10" selected>${esc(t('exp.res.10'))}</option><option value="60">${esc(t('exp.res.60'))}</option></select></label>
            <span class="muted small" data-count></span>
          </div>
          <div class="g2" data-cards></div>
          <span class="muted small">${esc(t('exp.nameNote', { name: '' }))}<span class="mono" data-basename></span></span>
        </section>
      </div>
      <div class="col" style="flex:1 1 340px">
        <section class="card">
          <h2>${esc(t('exp.share'))}</h2>
          <p class="small">${esc(t('exp.shareSub'))}</p>
          <div data-share></div>
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
  /** The printable report lives in step 4: show it, print once the maps have drawn, come back afterwards. */
  function printReport(ctx) {
    toast(t('exp.printPreparing'));
    const back = () => ctx.goto('export');
    window.addEventListener('afterprint', back, { once: true });
    ctx.goto('report');
    setTimeout(() => { try { window.print(); } catch { window.removeEventListener('afterprint', back); back(); } }, 1400);
  }
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
    renderSave(); renderShare();
  }
  function renderSave() {
    const box = el.querySelector('[data-save]');
    if (!hasServer()) { box.innerHTML = `<div class="banner info"><div class="body"><h3>${esc(t('start.noServer'))}</h3></div></div>`; return; }
    if (!session.code) { box.innerHTML = `<div class="banner info"><div class="body"><h3>${esc(t('exp.needCode'))}</h3><div class="sub">${esc(t('exp.needCodeSub'))}</div></div><div class="side"><button class="btn sm" type="button" data-act="gotoStart">${esc(t('exp.toStart'))}</button></div></div>`; return; }
    const f = state.flight, full = estimateSizes(0);
    box.innerHTML = `<div class="row"><span class="k2">${esc(t('rep.title'))}</span><span class="val" style="white-space:normal">${esc(flightTitle())}</span></div>
      <div class="row"><span class="k2">${esc(t('start.code'))}</span><span class="val">${esc(session.code)}${session.me && session.me.displayName ? ` · <span class="sub">${esc(session.me.displayName)}</span>` : ''}</span></div>
      <div class="row"><span class="k2">${esc(t('exp.saveWhat'))}</span><span class="val" style="white-space:normal"><span class="sub">${esc(t('exp.saveWhatSub', { n: fmtInt(full ? full.points : 0) }))}</span></span></div>
      ${f ? `<div class="row"><span class="k2">${esc(t('exp.savedAs'))}</span><span class="val">/v/${esc(f.id)}<br><span class="sub">${esc(t('exp.savedAt'))} ${fmtDateTimeUTC(f.updatedAt)}</span></span></div>` : ''}
      <div class="row-wrap" style="gap:10px;align-items:center"><button class="btn primary" type="button" data-act="save">${esc(f && !state.viewer ? t('exp.saveAgain') : t('exp.saveNow'))}</button><span class="muted small">${esc(t('exp.saveNote'))}</span></div>`;
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
      ${f.public && config.apiBase ? `<div class="msgpreview" data-msgpreview><div class="muted small">${esc(t('exp.msgPreview'))}</div><img alt="" src="${esc(`${config.apiBase}/api/view/${f.id}/preview.jpg?v=${previewVersion || f.updatedAt || 0}`)}" loading="lazy"><div class="muted small">${esc(t('exp.msgPreviewSub'))}</div></div>` : ''}`;
    box.querySelector('[data-qr]').innerHTML = qrSvg(url, { size: 132 });
  }
  let previewVersion = 0;
  const off = bus.on('track', render), off2 = bus.on('flight', () => { renderSave(); renderShare(); });
  const off3 = bus.on('preview', (d) => { if (d && d.ok) { previewVersion = Date.now(); renderShare(); } });   // image uploaded → show it
  render();
  root.appendChild(el);
  return { unmount: () => { off(); off2(); off3(); } };
}
