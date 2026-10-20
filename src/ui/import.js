// Phase 1 · Importieren: drop zone, parser worker, file/segment table, unknown formats.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast, confirmDialog } from '../util/dom.js';
import { fmtInt, fmtBytes, fmtDateTimeUTC, fmtTimeUTC, fmtDurationHM, fmtDateUTC } from '../util/format.js';
import { state, bus, recompute, resetAll } from '../state.js';
import { parseFiles } from '../parser.js';
import { openAssistant } from './assist.js';
import { removeProfile, sharedProfiles, localProfiles } from '../profiles-store.js';
import { session } from '../session.js';

const ACCEPT = '.csv,.jsonl,.json,.geojson,.txt,.gpx,.kml,.kmz,.igc,.zip,.log,.nmea';

export function mountImport(root, ctx) {
  const el = html(`<main class="page">
    <div class="row-wrap">
      <div class="col" style="flex:1 1 360px">
        <section class="card">
          <h2>${esc(t('imp.add'))}</h2>
          <div class="drop" data-drop>
            <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#1f5fbf" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0 4 4m-4-4-4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
            <strong>${esc(t('imp.dropTitle'))}</strong>
            <span class="muted small">${esc(t('imp.dropHint'))}</span>
            <label class="btn" style="cursor:pointer">${esc(t('imp.choose'))}<input type="file" multiple accept="${ACCEPT}" class="hidden" data-file></label>
          </div>
          <div class="muted small" data-progress></div>
          <label class="chk"><input type="checkbox" data-opt="hideOther" ${state.settings.hideOtherFlights ? 'checked' : ''}> ${esc(t('imp.hideOther'))}</label>
        </section>
        <section class="card" data-devices hidden></section>
        <section class="card">
          <h2>${esc(t('imp.profiles'))}</h2>
          <div data-profiles class="row-wrap" style="gap:8px"></div>
          <span class="muted small">${esc(t('imp.profilesHint'))}</span>
        </section>
        <div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))" data-tiles></div>
      </div>
      <section class="card" style="flex:2 1 560px">
        <div class="card-head"><h2>${esc(t('imp.files'))}</h2><button class="btn xs" type="button" data-act="reset">${esc(t('imp.reset'))}</button></div>
        <div class="scroll-x" data-table></div>
        <div class="legend"><span class="pill sm"><span class="dot g"></span>${esc(t('imp.leg.use'))}</span><span class="pill sm"><span class="dot x"></span>${esc(t('imp.leg.off'))}</span><span class="pill sm"><span class="dot y"></span>${esc(t('imp.leg.you'))}</span></div>
        <div data-unknown></div>
      </section>
    </div>
  </main>`);

  const drop = el.querySelector('[data-drop]');
  const fileIn = el.querySelector('[data-file]');
  const prog = el.querySelector('[data-progress]');
  const table = el.querySelector('[data-table]');
  const unk = el.querySelector('[data-unknown]');
  const tiles = el.querySelector('[data-tiles]');
  const profs = el.querySelector('[data-profiles]');
  const devCard = el.querySelector('[data-devices]');
  let askedOther = new Set();   // segments already asked about (file#part)

  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  fileIn.addEventListener('change', () => { if (fileIn.files.length) addFiles(fileIn.files); fileIn.value = ''; });
  el.querySelector('[data-opt="hideOther"]').addEventListener('change', (e) => { state.settings.hideOtherFlights = e.target.checked; ctx.saveSettings(); render(); });

  async function addFiles(list) {
    state.busy = true; prog.textContent = t('imp.reading', { n: list.length }); ctx.refreshBars();
    try {
      const results = await parseFiles(list, (m) => { prog.textContent = m.stage === 'parse' ? t('imp.parsing', { name: m.name, profile: m.profile }) : t('imp.readingFile', { name: m.name }); }, state.userProfiles);
      for (const r of results) {
        if (r.error) { toast(`${r.name}: ${r.error}`, true); continue; }
        if (r.unknown) { if (!state.unknown.some((u) => u.name === r.name)) state.unknown.push(r); continue; }
        // positions without any timestamps (aprs.fi KMZ, a bare KML LineString): nothing to analyse – say so
        if (r.timeless) { if (!state.unknown.some((u) => u.name === r.name)) state.unknown.push({ name: r.name, size: r.size, timeless: true, points: r.points.n, aprs: /aprs/i.test(r.name) }); continue; }
        if (state.files.some((f) => f.name === r.name && f.size === r.size)) continue; // same file dropped twice
        state.files.push(r);
      }
      prog.textContent = '';
      recompute();
      await askAboutOtherFlights();
      if (state.track) toast(t('imp.done', { n: results.filter((r) => r.points && !r.timeless).length }));
      else if (results.some((r) => r.timeless)) toast(t('imp.timelessToast'), true);
      else if (results.some((r) => r.unknown)) toast(t('imp.unknownToast'), true);
    } catch (err) { toast(err.message, true); prog.textContent = ''; }
    state.busy = false; ctx.refreshBars();
  }

  /** Recordings that look like another flight (far from the main cluster): ask once whether to ignore them. */
  async function askAboutOtherFlights() {
    const others = state.segments.filter((s) => s.status === 'other' && !askedOther.has(s.file + '#' + s.part));
    if (!others.length) return;
    others.forEach((s) => askedOther.add(s.file + '#' + s.part));
    const list = others.map((s) => `<li><span class="mono">${esc(s.file)}${s.part ? ` (${s.part}/${s.parts})` : ''}</span> · ${fmtDateUTC(s.t0)} ${fmtTimeUTC(s.t0)} – ${fmtDateUTC(s.t1)} ${fmtTimeUTC(s.t1)} UTC · ${fmtInt(s.n)} ${esc(t('imp.col.points'))}</li>`).join('');
    const main = state.stats && state.stats.takeoff ? fmtDateUTC(state.stats.takeoff.t) : '';
    const ignore = await confirmDialog({ title: t('imp.otherTitle', { n: others.length }), text: `<p>${esc(t('imp.otherText', { main }))}</p><ul class="small" style="margin:8px 0 0 18px">${list}</ul>`, okLabel: t('imp.otherIgnore'), cancelLabel: t('imp.otherKeep') });
    if (ignore) return;
    for (const s of others) { s.keep = true; s.status = 'use'; }
    recompute({ reclassify: false });
  }

  onAct(el, {
    merge: (b) => { state.settings.merge = { ...state.settings.merge, mode: b.dataset.mode }; ctx.saveSettings(); recompute({ reclassify: false }); },
    reset: async () => { if (await confirmDialog({ title: t('imp.reset'), text: esc(t('imp.resetText')), okLabel: t('imp.reset'), cancelLabel: t('common.cancel'), danger: true })) { resetAll(); } },
    seg: (b) => { const s = state.segments.find((x) => x.id === +b.dataset.id); if (!s) return; s.status = b.dataset.to; recompute({ reclassify: b.dataset.to !== 'off' && b.dataset.to !== 'use' }); },
    dropfile: (b) => { state.files = state.files.filter((f) => f.name !== b.dataset.name); recompute(); },
    dropunknown: (b) => { state.unknown = state.unknown.filter((f) => f.name !== b.dataset.name); render(); },
    assist: async (b) => {
      const u = state.unknown.find((f) => f.name === b.dataset.name); if (!u || !u.text) return;
      const profile = await openAssistant(u);
      if (!profile) return;
      state.unknown = state.unknown.filter((f) => f.name !== u.name);
      await addFiles([new File([u.text], u.name, { type: 'text/plain' })]);
    },
    dropprofile: async (b) => { try { await removeProfile(b.dataset.id, { code: session.code }); toast(t('as.removed')); render(); } catch { toast(t('start.errNetwork'), true); } },
  });

  function statusPill(s) {
    const map = { use: ['g', s.part ? t('imp.st.usePart', { n: s.part }) : t('imp.st.use')], dup: ['x', t('imp.st.dup', { id: s.dupOf })], other: ['x', t('imp.st.other')], off: ['x', t('imp.st.off')] };
    const [c, label] = map[s.status] || ['x', s.status];
    return `<span class="pill sm"><span class="dot ${c}"></span>${esc(label)}</span>`;
  }
  function actionFor(s) {
    if (s.status === 'use') return `<button class="btn xs" type="button" data-act="seg" data-id="${s.id}" data-to="off">${esc(t('imp.exclude'))}</button>`;
    return `<button class="btn xs" type="button" data-act="seg" data-id="${s.id}" data-to="use">${esc(t('imp.use'))}</button>`;
  }

  function render() {
    const segs = state.segments;
    const hidden = state.settings.hideOtherFlights ? segs.filter((s) => s.status === 'other') : [];
    const shown = segs.filter((s) => !hidden.includes(s));
    if (!segs.length && !state.unknown.length) {
      table.innerHTML = `<p class="muted">${esc(t('imp.empty'))}</p>`;
    } else {
      const rows = shown.map((s) => `<tr class="${s.status === 'use' ? '' : 'dim'}">
        <td class="mono file">${esc(s.file)}${s.part ? ` <span class="tag">${s.part}/${s.parts}</span>` : ''}</td>
        <td>${esc(s.profileName || '–')}</td>
        <td class="mono nowrap small">${fmtDateUTC(s.t0)} ${fmtTimeUTC(s.t0)} –<br>${fmtDateUTC(s.t1)} ${fmtTimeUTC(s.t1)}</td>
        <td class="r mono">${fmtInt(s.n)}</td>
        <td class="r mono">${s.n ? Math.round(100 * s.nFix / s.n) : 0}${' '}%</td>
        <td>${statusPill(s)}</td>
        <td class="r">${actionFor(s)}</td></tr>`).join('');
      const hiddenRow = hidden.length ? `<tr class="dim"><td colspan="6">${esc(t('imp.hiddenRow', { n: hidden.length }))}</td><td class="r"><button class="btn xs" type="button" data-showall>${esc(t('imp.showAll'))}</button></td></tr>` : '';
      table.innerHTML = `<table class="tbl"><thead><tr><th>${esc(t('imp.col.file'))}</th><th>${esc(t('imp.col.profile'))}</th><th>${esc(t('imp.col.range'))}</th><th class="r">${esc(t('imp.col.points'))}</th><th class="r">GPS</th><th>${esc(t('imp.col.status'))}</th><th></th></tr></thead><tbody>${rows}${hiddenRow}</tbody></table>`;
      const sa = table.querySelector('[data-showall]'); if (sa) sa.addEventListener('click', () => { state.settings.hideOtherFlights = false; ctx.saveSettings(); el.querySelector('[data-opt="hideOther"]').checked = false; render(); });
    }
    // unknown files
    unk.innerHTML = state.unknown.map((u) => u.timeless ? `<div class="banner warn" style="margin-top:8px"><div class="body"><h3>${esc(t('imp.timelessTitle', { name: u.name }))}</h3>
      <div class="sub">${esc(t('imp.timelessBody', { n: fmtInt(u.points) }))}</div>
      <div class="sub">${esc(u.aprs ? t('imp.timelessAprs') : t('imp.timelessNext'))}</div>
      </div><button class="btn xs" type="button" data-act="dropunknown" data-name="${esc(u.name)}">${esc(t('common.remove'))}</button></div>` : `<div class="banner warn" style="margin-top:8px"><div class="body"><h3>${esc(t('imp.unknownTitle', { name: u.name }))}</h3>
      <div class="sub">${esc(t('imp.unknownBody', { eol: u.analysis.eol, delim: u.analysis.delimiter ? JSON.stringify(u.analysis.delimiter) : '–', cols: u.analysis.columns }))}</div>
      <div class="sub">${esc(u.text ? t('imp.unknownAssist') : t('imp.unknownNext'))}</div>
      ${u.analysis.headerRow ? `<div class="mono small" style="margin-top:6px;word-break:break-all">${esc(u.analysis.headerRow.slice(0, 20).join(' · '))}</div>` : ''}
      </div><div class="col" style="gap:6px">${u.text ? `<button class="btn sm primary" type="button" data-act="assist" data-name="${esc(u.name)}">${esc(t('imp.assistBtn'))}</button>` : ''}<button class="btn xs" type="button" data-act="dropunknown" data-name="${esc(u.name)}">${esc(t('common.remove'))}</button></div></div>`).join('');
    // profiles
    const seen = new Map(); for (const f of state.files) if (f.profile) seen.set(f.profile.id, f.profile.name);
    const mine = [...sharedProfiles().filter((p) => p.createdBy && p.createdBy === session.code).map((p) => ({ id: p.id, name: p.name, where: 'shared' })), ...localProfiles().map((p) => ({ id: p.id, name: p.name, where: 'local' }))];
    const others = sharedProfiles().filter((p) => !(p.createdBy && p.createdBy === session.code)).map((p) => ({ id: p.id, name: p.name }));
    profs.innerHTML = ([...seen.values()].map((n) => `<span class="pill sm"><span class="dot g"></span>${esc(n)}</span>`).join('')
      + state.unknown.map((u) => `<span class="pill sm"><span class="dot y"></span>${esc(t('imp.unknownPill', { name: u.name }))}</span>`).join('')
      + mine.map((p) => `<span class="pill sm" title="${esc(p.where === 'shared' ? t('as.pillShared') : t('as.pillLocal'))}"><span class="dot b"></span>${esc(p.name)}${seen.has(p.id) ? '' : ''} <button type="button" class="tt-x inline" data-act="dropprofile" data-id="${esc(p.id)}" title="${esc(t('common.remove'))}">×</button></span>`).join('')
      + others.map((p) => `<span class="pill sm" title="${esc(t('as.pillShared'))}"><span class="dot x"></span>${esc(p.name)}</span>`).join(''))
      || `<span class="muted small">${esc(t('imp.noProfiles'))}</span>`;
    // tiles
    const tr = state.track;
    if (tr) {
      const ps = tr.points, t0 = ps.t[0], t1 = ps.t[ps.n - 1];
      const dropped = state.segments.reduce((s, x) => s + (x.status === 'use' ? x.dropped : 0), 0);
      tiles.innerHTML = `<div class="tile"><span class="k">${esc(t('imp.tile.range'))}</span><span class="v" style="font-size:15px;white-space:normal;line-height:1.3">${fmtDateUTC(t0)} ${fmtTimeUTC(t0)} –<br>${fmtDateUTC(t1)} ${fmtTimeUTC(t1)}</span><span class="u">UTC · ${fmtDurationHM((t1 - t0) / 1000)}</span></div>
        <div class="tile"><span class="k">${esc(t('imp.tile.points'))}</span><span class="v">${fmtInt(ps.n)}</span><span class="u">${esc(t('imp.tile.pointsSub', { n: fmtInt(tr.collapsed) }))}</span></div>
        <div class="tile"><span class="k">${esc(t('imp.tile.dropped'))}</span><span class="v">${fmtInt(dropped)}</span><span class="u">${esc(t('imp.tile.droppedSub'))}</span></div>`;
    } else tiles.innerHTML = '';
    renderDevices();
  }

  /** Card «Mehrere Geräte»: shown when recordings of two or more devices overlap in time. */
  function renderDevices() {
    const info = state.track && state.track.merge;
    if (!info || info.devices.length < 2 || !info.multiSec) { devCard.hidden = true; devCard.innerHTML = ''; return; }
    const m = state.settings.merge || {}; const mode = m.mode === 'primary' ? 'primary' : 'consensus';
    const primaryKey = info.primary;
    devCard.hidden = false;
    devCard.innerHTML = `<h2>${esc(t('imp.devices'))}</h2>
      <div class="muted small">${esc(t('imp.devicesSub', { n: info.devices.length, dur: fmtDurationHM(info.multiSec) }))}</div>
      <table class="tbl"><thead><tr><th>${esc(t('imp.col.device'))}</th><th class="r">${esc(t('imp.col.points'))}</th><th class="r">${esc(t('imp.col.coverage'))}</th></tr></thead><tbody>
        ${info.devices.map((d) => `<tr><td>${esc(d.name)}${d.key === primaryKey ? ` <span class="tag">${esc(t('imp.primaryTag'))}</span>` : ''}</td><td class="r mono">${fmtInt(d.n)}</td><td class="r mono">${fmtDurationHM(d.coverageSec)}</td></tr>`).join('')}
      </tbody></table>
      <div class="seg" style="align-self:flex-start"><button type="button" data-act="merge" data-mode="consensus" class="${mode === 'consensus' ? 'on' : ''}">${esc(t('imp.modeConsensus'))}</button><button type="button" data-act="merge" data-mode="primary" class="${mode === 'primary' ? 'on' : ''}">${esc(t('imp.modePrimary'))}</button></div>
      <div class="row-wrap" style="gap:12px;align-items:flex-end">
        <label class="f">${esc(t('imp.primaryDevice'))}<select class="in sm" data-primary style="width:auto">${info.devices.map((d) => `<option value="${esc(d.key)}" ${d.key === primaryKey ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
        ${mode === 'consensus' ? `<label class="f">${esc(t('imp.gridStep'))}<select class="in sm" data-step style="width:auto">${[5, 10, 20, 30, 60].map((s) => `<option value="${s}" ${(m.stepSec || 10) === s ? 'selected' : ''}>${s} s</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="muted small">${esc(mode === 'consensus' ? t('imp.consensusNote', { grid: info.gridPoints, rejected: info.rejected }) : t('imp.primaryNote', { dur: fmtDurationHM(info.filledSec) }))}</div>`;
    devCard.querySelector('[data-primary]').addEventListener('change', (e) => { state.settings.merge = { ...state.settings.merge, primary: e.target.value }; ctx.saveSettings(); recompute({ reclassify: false }); });
    const st = devCard.querySelector('[data-step]'); if (st) st.addEventListener('change', (e) => { state.settings.merge = { ...state.settings.merge, stepSec: +e.target.value }; ctx.saveSettings(); recompute({ reclassify: false }); });
  }

  const off = bus.on('track', render), off2 = bus.on('profiles', render);
  render();
  root.appendChild(el);
  return { unmount: () => { off(); off2(); } };
}

/** Status line for the action bar. */
export function importStatus() {
  const n = state.files.length, segs = state.segments.filter((s) => s.status === 'use').length;
  if (!n && !state.unknown.length) return esc(t('imp.statusEmpty'));
  const tr = state.track;
  return tx('imp.status', { files: n, segs, points: tr ? fmtInt(tr.points.n) : '0', unknown: state.unknown.length });
}
