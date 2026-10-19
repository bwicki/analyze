// Phase 1 · Importieren: drop zone, parser worker, file/segment table, unknown formats.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast, confirmDialog } from '../util/dom.js';
import { fmtInt, fmtBytes, fmtDateTimeUTC, fmtTimeUTC, fmtDurationHM, fmtDayUTC } from '../util/format.js';
import { state, bus, recompute, resetAll } from '../state.js';
import { parseFiles } from '../parser.js';

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

  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  fileIn.addEventListener('change', () => { if (fileIn.files.length) addFiles(fileIn.files); fileIn.value = ''; });
  el.querySelector('[data-opt="hideOther"]').addEventListener('change', (e) => { state.settings.hideOtherFlights = e.target.checked; ctx.saveSettings(); render(); });

  async function addFiles(list) {
    state.busy = true; prog.textContent = t('imp.reading', { n: list.length }); ctx.refreshBars();
    try {
      const results = await parseFiles(list, (m) => { prog.textContent = m.stage === 'parse' ? t('imp.parsing', { name: m.name, profile: m.profile }) : t('imp.readingFile', { name: m.name }); });
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
      if (state.track) toast(t('imp.done', { n: results.filter((r) => r.points && !r.timeless).length }));
      else if (results.some((r) => r.timeless)) toast(t('imp.timelessToast'), true);
      else if (results.some((r) => r.unknown)) toast(t('imp.unknownToast'), true);
    } catch (err) { toast(err.message, true); prog.textContent = ''; }
    state.busy = false; ctx.refreshBars();
  }

  onAct(el, {
    reset: async () => { if (await confirmDialog({ title: t('imp.reset'), text: esc(t('imp.resetText')), okLabel: t('imp.reset'), cancelLabel: t('common.cancel'), danger: true })) { resetAll(); } },
    seg: (b) => { const s = state.segments.find((x) => x.id === +b.dataset.id); if (!s) return; s.status = b.dataset.to; recompute({ reclassify: b.dataset.to !== 'off' && b.dataset.to !== 'use' }); },
    dropfile: (b) => { state.files = state.files.filter((f) => f.name !== b.dataset.name); recompute(); },
    dropunknown: (b) => { state.unknown = state.unknown.filter((f) => f.name !== b.dataset.name); render(); },
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
        <td class="mono">${esc(s.file)}${s.part ? ` <span class="tag">${s.part}/${s.parts}</span>` : ''}</td>
        <td>${esc(s.profileName || '–')}</td>
        <td class="mono nowrap small">${fmtDayUTC(s.t0)} ${fmtTimeUTC(s.t0)} –<br>${fmtDayUTC(s.t1)} ${fmtTimeUTC(s.t1)}</td>
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
      <div class="sub">${esc(t('imp.unknownNext'))}</div>
      ${u.analysis.headerRow ? `<div class="mono small" style="margin-top:6px;word-break:break-all">${esc(u.analysis.headerRow.slice(0, 20).join(' · '))}</div>` : ''}
      </div><button class="btn xs" type="button" data-act="dropunknown" data-name="${esc(u.name)}">${esc(t('common.remove'))}</button></div>`).join('');
    // profiles
    const seen = new Map(); for (const f of state.files) if (f.profile) seen.set(f.profile.id, f.profile.name);
    profs.innerHTML = [...seen.values()].map((n) => `<span class="pill sm"><span class="dot g"></span>${esc(n)}</span>`).join('') + state.unknown.map((u) => `<span class="pill sm"><span class="dot y"></span>${esc(t('imp.unknownPill', { name: u.name }))}</span>`).join('') || `<span class="muted small">${esc(t('imp.noProfiles'))}</span>`;
    // tiles
    const tr = state.track;
    if (tr) {
      const ps = tr.points, t0 = ps.t[0], t1 = ps.t[ps.n - 1];
      const dropped = state.segments.reduce((s, x) => s + (x.status === 'use' ? x.dropped : 0), 0);
      tiles.innerHTML = `<div class="tile"><span class="k">${esc(t('imp.tile.range'))}</span><span class="v" style="font-size:15px;white-space:normal;line-height:1.3">${fmtDayUTC(t0)} ${fmtTimeUTC(t0)} –<br>${fmtDayUTC(t1)} ${fmtTimeUTC(t1)}</span><span class="u">UTC · ${fmtDurationHM((t1 - t0) / 1000)}</span></div>
        <div class="tile"><span class="k">${esc(t('imp.tile.points'))}</span><span class="v">${fmtInt(ps.n)}</span><span class="u">${esc(t('imp.tile.pointsSub', { n: fmtInt(tr.collapsed) }))}</span></div>
        <div class="tile"><span class="k">${esc(t('imp.tile.dropped'))}</span><span class="v">${fmtInt(dropped)}</span><span class="u">${esc(t('imp.tile.droppedSub'))}</span></div>`;
    } else tiles.innerHTML = '';
  }

  const off = bus.on('track', render);
  render();
  root.appendChild(el);
  return { unmount: off };
}

/** Status line for the action bar. */
export function importStatus() {
  const n = state.files.length, segs = state.segments.filter((s) => s.status === 'use').length;
  if (!n && !state.unknown.length) return esc(t('imp.statusEmpty'));
  const tr = state.track;
  return tx('imp.status', { files: n, segs, points: tr ? fmtInt(tr.points.n) : '0', unknown: state.unknown.length });
}
