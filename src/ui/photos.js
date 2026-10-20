// Fotos card (phase 3): upload JPEGs to the saved flight (EXIF time → track position), camera zone
// and fine offset, thumbnails with time/place/caption, lightbox; markers on map and profile via photosForDisplay().
// Any photo can get a time by hand (UTC field or "take the pinned point"): photos without EXIF time show the field
// at once, others behind «Zeit von Hand …»; the hand time wins, «×» removes it and the EXIF time applies again (0.7.3).

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast, confirmDialog } from '../util/dom.js';
import { fmtTimeUTC, fmtDayUTC, fmtInt, icaoShort, fmtBytes } from '../util/format.js';
import { state, bus } from '../state.js';
import { api } from '../api.js';
import { session, hasServer } from '../session.js';
import { prepareUpload } from '../photos/process.js';
import { setPhotos, setCameraSettings, cameraTz, cameraOffsetSec, loadPhotos } from '../photos/store.js';
import { suggestCameraZone, photoUtc } from '../photos/place.js';

export const PHOTO_COLOR = '#0f766e';

/** Photos for map/profile: placed on the track and inside the trim. */
export function photosForDisplay() {
  return (state.photosPlaced || []).filter((p) => p.onTrack && p.inTrim).map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, dist: p.dist, color: PHOTO_COLOR, label: `📷 ${fmtTimeUTC(p.t)} UTC${p.caption ? ' · ' + p.caption.slice(0, 60) : ''}`, type: 'photo', typeLabel: t('ph.title'), text: p.caption || '', id: p.id }));
}

const tzLabel = (min) => { const s = min < 0 ? '−' : '+'; const a = Math.abs(min); return `UTC${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`; };
// datetime-local <-> UTC ms (the field is used as a UTC field; the browser zone never applies)
const toInput = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19) : '');
const fromInput = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : NaN; };

export function mountPhotosCard(container, o = {}) {
  const el = html(`<section class="card" data-photos>
    <div class="card-head"><h2>${esc(t('ph.title'))} <span class="pill sm" data-count>0</span></h2><div class="row-wrap noprint" style="gap:8px;align-items:center" data-tools></div></div>
    <div data-settings class="row-wrap noprint" style="gap:12px;align-items:flex-end"></div>
    <div data-progress class="muted small"></div>
    <div data-grid class="photogrid"></div>
    <div data-hint class="muted small"></div>
  </section>`);
  const fileIn = html(`<input type="file" accept="image/jpeg,.jpg,.jpeg" multiple class="hidden">`);
  el.appendChild(fileIn);
  const tools = el.querySelector('[data-tools]'), grid = el.querySelector('[data-grid]'), count = el.querySelector('[data-count]'), hint = el.querySelector('[data-hint]'), settings = el.querySelector('[data-settings]'), prog = el.querySelector('[data-progress]');
  const canEdit = () => !!state.flight && !state.viewer && hasServer() && !!session.code;
  const openManual = new Set();          // photo ids whose hand-time field is unfolded although an EXIF time exists

  function render() {
    const placed = state.photosPlaced || [];
    count.textContent = String(placed.length);
    tools.innerHTML = canEdit() ? `<button class="btn chip primary" type="button" data-act="add">${esc(t('ph.add'))}</button>` : '';
    if (!state.flight) {
      settings.innerHTML = ''; grid.innerHTML = '';
      hint.innerHTML = state.viewer ? '' : (hasServer() && session.code ? `${esc(t('ph.needSave'))} <a href="#" data-act="toExport">${esc(t('ph.toExport'))}</a>` : esc(t('ph.needCode')));
      return;
    }
    if (canEdit() || placed.length) {
      const tz = cameraTz(), off = cameraOffsetSec();
      const opts = []; for (let m = -12 * 60; m <= 14 * 60; m += 30) opts.push(`<option value="${m}" ${m === tz ? 'selected' : ''}>${tzLabel(m)}</option>`);
      settings.innerHTML = canEdit() ? `<label class="f">${esc(t('ph.cameraZone'))}<select class="in sm" data-tz style="width:auto">${opts.join('')}</select></label>
        <label class="f">${esc(t('ph.offset'))}<input class="in sm" type="number" step="1" data-off value="${off}" style="width:110px"></label>
        <button class="btn sm" type="button" data-act="suggest">${esc(t('ph.suggest'))}</button>
        <span class="muted small" style="flex:1 1 260px">${esc(t('ph.zoneHint'))}</span>` : `<span class="muted small">${esc(t('ph.zoneShown', { tz: tzLabel(tz) }))}</span>`;
      const tzSel = settings.querySelector('[data-tz]'), offIn = settings.querySelector('[data-off]');
      if (tzSel) tzSel.addEventListener('change', () => setCameraSettings({ tzMinutes: +tzSel.value }));
      if (offIn) offIn.addEventListener('change', () => setCameraSettings({ offsetSec: Math.round(+offIn.value || 0) }));
    } else settings.innerHTML = '';
    if (!placed.length) { grid.innerHTML = ''; hint.textContent = canEdit() ? t('ph.empty') : t('ph.emptyViewer'); return; }
    hint.textContent = t('ph.hint');
    const tr = state.track && state.track.points.n ? state.track.points : null;
    const range = tr ? ` min="${toInput(tr.t[0] - 3600000)}" max="${toInput(tr.t[tr.n - 1] + 3600000)}"` : '';
    grid.innerHTML = placed.map((p) => {
      const exifUtc = p.manual && Number.isFinite(p.cameraTime) ? photoUtc({ ...p, manualTime: null, manual: false }, { tzMinutes: cameraTz(), offsetSec: cameraOffsetSec() }) : NaN;
      const manualTag = p.manual ? ` <span class="muted" title="${esc(Number.isFinite(exifUtc) ? t('ph.exifKept', { t: `${fmtDayUTC(exifUtc)} ${fmtTimeUTC(exifUtc)} UTC` }) : t('ph.manualTitle'))}">· ${esc(t('ph.manual'))}</span>` : '';
      const when = Number.isNaN(p.t) ? `<span class="err">${esc(t('ph.noTime'))}</span>` : `${fmtDayUTC(p.t)} ${fmtTimeUTC(p.t)} UTC${manualTag}`;
      const where = p.onTrack ? icaoShort(p.lat, p.lon) : (Number.isNaN(p.t) ? '' : `<span class="muted">${esc(t('ph.offTrack'))}</span>`);
      const delta = !Number.isNaN(p.distM) ? ` · Δ ${p.distM > 2000 ? `<span class="err">${fmtInt(p.distM / 1000)} km</span>` : `${fmtInt(p.distM)} m`}` : '';
      // hand time: UTC field + "take the pinned point" + clear – unfolded for photos without EXIF time or already
      // placed by hand, otherwise behind a small «Zeit von Hand …» link (the EXIF time is kept for «×»)
      const unfolded = Number.isNaN(p.t) || p.manual || openManual.has(p.id);
      const manual = !canEdit() ? '' : unfolded ? `<span class="manual-time">
            <span class="muted small">${esc(t('ph.manualLabel'))}</span>
            <input class="in sm" type="datetime-local" step="1" data-man="${esc(p.id)}" value="${toInput(p.manual ? p.t : NaN)}"${range} title="${esc(t('ph.manualTitle'))}">
            <span class="row-wrap" style="gap:4px"><button type="button" class="btn sm" data-act="fromPin" data-id="${esc(p.id)}" title="${esc(t('ph.fromPinTitle'))}">${esc(t('ph.fromPin'))}</button>
            ${p.manual ? `<button type="button" class="btn sm" data-act="clearTime" data-id="${esc(p.id)}" title="${esc(Number.isFinite(exifUtc) ? t('ph.clearTimeExif') : t('ph.clearTime'))}">×</button>` : (openManual.has(p.id) ? `<button type="button" class="btn sm" data-act="foldTime" data-id="${esc(p.id)}" title="${esc(t('common.cancel'))}">×</button>` : '')}</span>
          </span>` : `<a href="#" class="small" data-act="editTime" data-id="${esc(p.id)}" title="${esc(t('ph.editTimeTitle'))}">${esc(t('ph.editTime'))}</a>`;
      return `<figure class="photo ${p.inTrim && p.onTrack ? '' : 'dim'}" data-id="${esc(p.id)}">
        <img src="${esc(api.photos.url(p.id, true))}" alt="" loading="lazy" data-act="open" data-id="${esc(p.id)}">
        <figcaption><span class="mono small">${when}</span><span class="small">${where}${delta}</span>${manual}
          ${canEdit() ? `<input class="in sm cap" data-cap="${esc(p.id)}" value="${esc(p.caption)}" placeholder="${esc(t('ph.captionPh'))}" maxlength="300">` : (p.caption ? `<span class="small">${esc(p.caption)}</span>` : '')}
        </figcaption>
        ${canEdit() ? `<button type="button" class="tt-x del" data-act="del" data-id="${esc(p.id)}" title="${esc(t('common.remove'))}">×</button>` : ''}
      </figure>`;
    }).join('');
    grid.querySelectorAll('[data-cap]').forEach((inp) => inp.addEventListener('change', async () => {
      try { const rec = await api.photos.update(state.flight.id, inp.dataset.cap, { caption: inp.value }); setPhotos(state.photos.map((x) => (x.id === rec.id ? rec : x))); }
      catch { toast(t('start.errNetwork'), true); }
    }));
    grid.querySelectorAll('[data-man]').forEach((inp) => inp.addEventListener('change', () => { const ms = fromInput(inp.value); if (Number.isFinite(ms)) setManualTime(inp.dataset.man, ms); }));
  }

  /** Store a hand-entered UTC time (ms) for a photo; null removes it (the EXIF time, if any, applies again). */
  async function setManualTime(id, ms) {
    try {
      const rec = await api.photos.update(state.flight.id, id, { manualTime: ms === null ? null : Math.round(ms) });
      openManual.delete(id);
      setPhotos(state.photos.map((x) => (x.id === rec.id ? rec : x)));
      if (ms !== null) { const pl = (state.photosPlaced || []).find((x) => x.id === id); toast(pl && pl.onTrack ? t('ph.placed', { pos: icaoShort(pl.lat, pl.lon) }) : t('ph.placedOff')); }
    } catch { toast(t('start.errNetwork'), true); }
  }

  async function addFiles(files) {
    const list = Array.from(files).filter((f) => /image\/jpeg/.test(f.type) || /\.jpe?g$/i.test(f.name));
    if (!list.length) { toast(t('ph.jpegOnly'), true); return; }
    let done = 0, failed = 0, noTime = 0;
    for (const f of list) {
      prog.textContent = t('ph.uploading', { n: done + 1, total: list.length, name: f.name });
      try {
        const u = await prepareUpload(f);
        if (Number.isNaN(u.cameraTime)) noTime++;
        const rec = await api.photos.upload(state.flight.id, { name: f.name, cameraTime: Number.isNaN(u.cameraTime) ? null : u.cameraTime, exifTz: u.exifTz, exifLat: u.exif ? u.exif.lat : null, exifLon: u.exif ? u.exif.lon : null, exifAlt: u.exif ? u.exif.alt : null, width: u.width, height: u.height }, u.image, u.thumb);
        state.photos = [...(state.photos || []), rec]; done++;
      } catch (ex) { console.error(ex); failed++; if (ex && ex.status === 413) { toast(t('ph.quota'), true); break; } }
      setPhotos(state.photos);
    }
    prog.textContent = '';
    toast(t('ph.uploaded', { n: done, failed }) + (noTime ? ' ' + t('ph.noTimeNote', { n: noTime }) : ''), failed > 0);
    // first upload: propose the camera zone from GPS photos when it disagrees with the setting
    const sug = suggestCameraZone(state.photos, state.track, state.series);
    if (sug && sug.tzMinutes !== cameraTz() && sug.meanDistM < 500) { setCameraSettings({ tzMinutes: sug.tzMinutes }); toast(t('ph.zoneSet', { tz: tzLabel(sug.tzMinutes) })); }
  }

  function openLightbox(id) {
    const placed = state.photosPlaced || []; let i = placed.findIndex((p) => p.id === id); if (i < 0) return;
    const bg = html(`<div class="lightbox"><button type="button" class="lb-x" data-act="close">×</button><button type="button" class="lb-nav prev" data-act="prev">‹</button><img alt=""><button type="button" class="lb-nav next" data-act="next">›</button><div class="lb-cap" data-cap></div></div>`);
    const img = bg.querySelector('img'), cap = bg.querySelector('[data-cap]');
    const show = () => { const p = placed[i]; img.src = api.photos.url(p.id, false); cap.innerHTML = `<strong>${Number.isNaN(p.t) ? '' : fmtDayUTC(p.t) + ' ' + fmtTimeUTC(p.t) + ' UTC'}</strong>${p.onTrack ? ` · ${icaoShort(p.lat, p.lon)}` : ''}${p.caption ? `<br>${esc(p.caption)}` : ''}<span class="muted"> · ${i + 1}/${placed.length}</span>`; };
    onAct(bg, { close: () => bg.remove(), prev: () => { i = (i - 1 + placed.length) % placed.length; show(); }, next: () => { i = (i + 1) % placed.length; show(); } });
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target === img) bg.remove(); });
    const key = (e) => { if (e.key === 'Escape') { bg.remove(); document.removeEventListener('keydown', key); } else if (e.key === 'ArrowLeft') { i = (i - 1 + placed.length) % placed.length; show(); } else if (e.key === 'ArrowRight') { i = (i + 1) % placed.length; show(); } };
    document.addEventListener('keydown', key);
    document.body.appendChild(bg); show();
  }

  fileIn.addEventListener('change', () => { if (fileIn.files.length) addFiles(fileIn.files); fileIn.value = ''; });
  onAct(el, {
    add: () => fileIn.click(),
    toExport: () => o.goto && o.goto('export'),
    open: (b) => openLightbox(b.dataset.id),
    del: async (b) => {
      const ok = await confirmDialog({ title: t('ph.deleteTitle'), text: esc(t('ph.deleteText')), okLabel: t('common.remove'), cancelLabel: t('common.cancel'), danger: true });
      if (!ok) return;
      try { await api.photos.remove(state.flight.id, b.dataset.id); setPhotos(state.photos.filter((x) => x.id !== b.dataset.id)); } catch { toast(t('start.errNetwork'), true); }
    },
    suggest: () => {
      const sug = suggestCameraZone(state.photos, state.track, state.series);
      if (!sug) { toast(t('ph.noSuggestion'), true); return; }
      setCameraSettings({ tzMinutes: sug.tzMinutes }); toast(t('ph.zoneSet', { tz: tzLabel(sug.tzMinutes) }));
    },
    fromPin: (b) => {
      const q = o.getPinned ? o.getPinned() : null;
      if (!q || !Number.isFinite(q.t)) { toast(t('ph.noPin'), true); return; }
      setManualTime(b.dataset.id, q.t);
    },
    clearTime: (b) => setManualTime(b.dataset.id, null),
    editTime: (b) => { openManual.add(b.dataset.id); render(); },
    foldTime: (b) => { openManual.delete(b.dataset.id); render(); },
  });
  grid.addEventListener('mouseover', (e) => { const fig = e.target.closest('figure.photo'); if (!fig || !o.onSelect) return; o.onSelect((state.photosPlaced || []).find((p) => p.id === fig.dataset.id) || null); });
  grid.addEventListener('mouseleave', () => o.onSelect && o.onSelect(null));
  const off1 = bus.on('photos', render), off2 = bus.on('flight', render), off3 = bus.on('track', render);
  render();
  if (state.flight && !(state.photos || []).length) loadPhotos();
  container.appendChild(el);
  return { unmount: () => { off1(); off2(); off3(); } };
}
