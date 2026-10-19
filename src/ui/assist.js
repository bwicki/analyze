// Profil-Assistent (design board "Profilassistent"): three steps – read the file, map the columns onto
// the Normfelder, name and save. The profile is JSON; shared via the Worker (everyone) or kept locally.

import { t, tx } from '../i18n.js';
import { esc, html, onAct, toast } from '../util/dom.js';
import { fmtInt, fmtDateTimeUTC, fmtNum } from '../util/format.js';
import { state } from '../state.js';
import { analyseText, restructure, suggestMapping, buildProfile, missingRequired, previewProfile, NORM_FIELDS, columnStats } from '../parse/assist.js';
import { saveProfile } from '../profiles-store.js';
import { session, hasServer } from '../session.js';

const DATE_FORMATS = ['dd/MM/yy', 'd/M/yy', 'yyyy-MM-dd', 'MM/dd/yy'];

/**
 * Open the assistant for an unknown file {name, size, text}. Resolves with the saved profile (spec) or null.
 */
export function openAssistant(file) {
  return new Promise((resolve) => {
    const text = file.text || '';
    let struct = analyseText(text, file.name);
    let mapping = suggestMapping(struct);
    let step = 1, preview = null;
    const meta = { name: '', manufacturer: '', share: hasServer() && !!session.code, noFixWhenZero: true, minYear: 2015 };

    const bg = html(`<div class="modal-bg"><section class="modal assist" role="dialog" aria-modal="true" aria-label="${esc(t('as.title'))}">
      <div class="head"><div><div class="k">${esc(t('as.kicker'))}</div><h1 data-title></h1></div><button class="btn sm" type="button" data-act="cancel">${esc(t('common.cancel'))}</button></div>
      <div class="steps-nav" data-nav></div>
      <div data-body class="col" style="gap:14px"></div>
      <div class="foot" data-foot></div>
    </section></div>`);
    const body = bg.querySelector('[data-body]'), foot = bg.querySelector('[data-foot]');
    const close = (v) => { bg.remove(); resolve(v); };

    function counts() {
      const mapped = NORM_FIELDS.filter((f) => f.key === 'time' ? (mapping.time && (mapping.time.col || (mapping.time.date && mapping.time.time))) : (mapping[f.key] && mapping[f.key].col)).length;
      return { mapped, missing: missingRequired(mapping) };
    }
    function renderHead() {
      const c = counts();
      bg.querySelector('[data-title]').textContent = t('as.heading', { name: file.name, step, mapped: c.mapped, total: NORM_FIELDS.length, req: 3 - c.missing.length });
      bg.querySelector('[data-nav]').innerHTML = [1, 2, 3].map((n) => `<span class="ph ${n === step ? 'active' : n < step ? 'done' : ''}"><span class="n">${n < step ? '✓' : n}</span>${esc(t('as.step' + n))}</span>`).join('');
      const c2 = counts();
      const canSave = !c2.missing.length && preview && preview.plausible && meta.name.trim().length >= 2;
      foot.innerHTML = `${step > 1 ? `<button class="btn" type="button" data-act="back">← ${esc(t('as.step' + (step - 1)))}</button>` : ''}<span style="flex:1"></span>
        ${step < 3 ? `<button class="btn primary" type="button" data-act="next" ${step === 2 && c2.missing.length ? 'disabled' : ''}>${esc(t('as.next', { step: t('as.step' + (step + 1)) }))} →</button>` : `<button class="btn primary" type="button" data-act="save" ${canSave ? '' : 'disabled'}>${esc(t('as.save'))}</button>`}`;
    }

    function renderStep1() {
      const sample = (struct.kind === 'delimited' ? text.replace(/^﻿/, '').split(/\r\n|\r|\n/).filter((l) => l.trim()).slice(0, 4) : struct.rows.slice(0, 3).map((r) => JSON.stringify(Object.fromEntries(struct.columns.map((c, i) => [c, r[i]])))));
      const delimName = { ';': t('as.semicolon'), ',': t('as.comma'), '\t': t('as.tab'), '|': t('as.pipe') };
      body.innerHTML = `<div class="banner info"><div class="body"><h3>${esc(t('as.analysed'))}</h3><div class="sub">${esc(struct.kind === 'delimited' ? t('as.structDelimited', { delim: delimName[struct.delimiter] || struct.delimiter, header: struct.header ? t('common.yes') : t('common.no'), eol: struct.eol, cols: struct.columns.length, rows: fmtInt(struct.nRows) }) : t('as.structJson', { kind: struct.kind === 'jsonl' ? 'JSON Lines' : 'JSON', cols: struct.columns.length, rows: fmtInt(struct.nRows) }))}</div></div></div>
        ${struct.kind === 'delimited' ? `<div class="g3">
          <label class="f">${esc(t('as.delimiter'))}<select class="in sm" data-s="delimiter">${[';', ',', '\t', '|'].map((d) => `<option value="${d === '\t' ? 'TAB' : d}" ${struct.delimiter === d ? 'selected' : ''}>${esc(delimName[d])}</option>`).join('')}</select></label>
          <label class="f">${esc(t('as.header'))}<select class="in sm" data-s="header"><option value="1" ${struct.header ? 'selected' : ''}>${esc(t('as.headerYes'))}</option><option value="0" ${!struct.header ? 'selected' : ''}>${esc(t('as.headerNo'))}</option></select></label>
          <label class="f">${esc(t('as.decimal'))}<select class="in sm" data-s="decimal"><option value="." ${struct.decimal === '.' ? 'selected' : ''}>${esc(t('as.point'))}</option><option value="," ${struct.decimal === ',' ? 'selected' : ''}>${esc(t('as.commaDec'))}</option></select></label>
        </div>` : ''}
        <div><div class="k">${esc(t('as.columns'))}</div><div class="mono small" style="word-break:break-all">${esc(struct.columns.join(struct.kind === 'delimited' ? struct.delimiter : ', '))}</div></div>
        <div><div class="k">${esc(t('as.sample'))}</div><pre class="sample">${esc(sample.join('\n'))}</pre></div>`;
      body.querySelectorAll('[data-s]').forEach((sel) => sel.addEventListener('change', () => {
        const delimiter = body.querySelector('[data-s="delimiter"]').value.replace('TAB', '\t');
        struct = restructure(text, file.name, { delimiter, header: body.querySelector('[data-s="header"]').value === '1', decimal: body.querySelector('[data-s="decimal"]').value });
        mapping = suggestMapping(struct); preview = null; renderStep1(); renderHead();
      }));
    }

    function renderStep2() {
      const stats = columnStats(struct);
      const colOpts = (sel) => `<option value="">${esc(t('as.none'))}</option>` + struct.columns.map((c) => `<option value="${esc(c)}" ${sel === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
      const exampleOf = (col) => { const st = stats.find((x) => x.name === col); return st ? st.example : ''; };
      const conf = (c) => c === 'sure' ? `<span class="tag" style="background:var(--ok-bg);color:var(--ok-text)">${esc(t('as.sure'))}</span>` : c === 'check' ? `<span class="tag" style="background:var(--warn-bg);color:var(--warn-text)">${esc(t('as.check'))}</span>` : `<span class="tag">${esc(t('as.absent'))}</span>`;
      const tm = mapping.time || {};
      const timeMode = tm.date && tm.time ? 'pair' : 'single';
      const rows = NORM_FIELDS.map((f) => {
        if (f.key === 'time') {
          return `<tr><td><strong>${esc(t('as.f.time'))}</strong> <span class="tag">${esc(t('as.required'))}</span></td>
            <td><select class="in sm" data-tmode><option value="single" ${timeMode === 'single' ? 'selected' : ''}>${esc(t('as.timeSingle'))}</option><option value="pair" ${timeMode === 'pair' ? 'selected' : ''}>${esc(t('as.timePair'))}</option></select>
              ${timeMode === 'single' ? `<select class="in sm" data-m="time.col">${colOpts(tm.col)}</select>` : `<select class="in sm" data-m="time.date">${colOpts(tm.date)}</select><select class="in sm" data-m="time.time">${colOpts(tm.time)}</select>`}</td>
            <td class="mono small">${esc(timeMode === 'single' ? exampleOf(tm.col) : `${exampleOf(tm.date)} ${exampleOf(tm.time)}`)}</td>
            <td>${timeMode === 'single' ? `<select class="in sm" data-m="time.format"><option value="auto" ${!tm.format || tm.format === 'auto' ? 'selected' : ''}>${esc(t('as.fmtAuto'))}</option><option value="unix" ${tm.format === 'unix' ? 'selected' : ''}>Unix s</option><option value="unixms" ${tm.format === 'unixms' ? 'selected' : ''}>Unix ms</option></select>` : `<select class="in sm" data-m="time.dateFormat">${DATE_FORMATS.map((d) => `<option ${tm.dateFormat === d ? 'selected' : ''}>${d}</option>`).join('')}</select> <span class="muted small">UTC</span>`}</td>
            <td>${conf(tm.confidence)}</td></tr>`;
        }
        const m = mapping[f.key] || {};
        return `<tr><td>${esc(t('as.f.' + f.key))}${f.required ? ` <span class="tag">${esc(t('as.required'))}</span>` : ''}</td>
          <td><select class="in sm" data-m="${f.key}.col">${colOpts(m.col)}</select></td>
          <td class="mono small">${esc(exampleOf(m.col))}</td>
          <td>${f.units.length ? `<select class="in sm" data-m="${f.key}.unit">${f.units.map((u) => `<option ${m.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select>` : '<span class="muted small">' + esc(t('as.u.' + f.key)) + '</span>'}</td>
          <td>${conf(m.col ? m.confidence : 'none')}</td></tr>`;
      }).join('');
      body.innerHTML = `<p class="small">${esc(t('as.mapHint'))}</p>
        <div class="scroll-x"><table class="tbl map"><thead><tr><th>${esc(t('as.col.field'))}</th><th>${esc(t('as.col.column'))}</th><th>${esc(t('as.col.example'))}</th><th>${esc(t('as.col.unit'))}</th><th>${esc(t('as.col.conf'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="row-wrap" style="gap:16px"><label class="chk"><input type="checkbox" data-meta="noFixWhenZero" ${meta.noFixWhenZero ? 'checked' : ''}> ${esc(t('as.noFixZero'))}</label><label class="chk"><input type="checkbox" data-meta="minYear" ${meta.minYear ? 'checked' : ''}> ${esc(t('as.minYear'))}</label></div>
        <section class="card" style="background:#f9fafb"><div class="card-head"><h2>${esc(t('as.preview'))}</h2><button class="btn sm primary" type="button" data-act="preview">${esc(t('as.previewBtn'))}</button></div><div data-preview>${previewHtml()}</div></section>`;
      body.querySelectorAll('[data-m]').forEach((sel) => sel.addEventListener('change', () => {
        const [k, prop] = sel.dataset.m.split('.');
        mapping[k] = { ...(mapping[k] || {}), [prop]: sel.value || undefined, confidence: sel.value ? 'sure' : 'none' };
        if (k !== 'time' && prop === 'col' && sel.value && !mapping[k].unit) { const f = NORM_FIELDS.find((x) => x.key === k); if (f.units.length) mapping[k].unit = f.units[0]; }
        preview = null; renderStep2(); renderHead();
      }));
      const tmode = body.querySelector('[data-tmode]');
      tmode.addEventListener('change', () => { mapping.time = tmode.value === 'pair' ? { date: undefined, time: undefined, dateFormat: 'dd/MM/yy', confidence: 'none' } : { col: undefined, format: 'auto', confidence: 'none' }; preview = null; renderStep2(); renderHead(); });
      body.querySelectorAll('[data-meta]').forEach((cb) => cb.addEventListener('change', () => { if (cb.dataset.meta === 'minYear') meta.minYear = cb.checked ? 2015 : 0; else meta[cb.dataset.meta] = cb.checked; preview = null; }));
    }
    function previewHtml() {
      if (!preview) return `<p class="muted small">${esc(t('as.previewHint'))}</p>`;
      const p = preview;
      return `<div class="row-wrap" style="gap:16px;align-items:flex-start"><div style="flex:1 1 260px">
          <div class="row"><span class="k2">${esc(t('as.pv.range'))}</span><span class="val small">${p.t0 ? `${fmtDateTimeUTC(p.t0)} – ${fmtDateTimeUTC(p.t1)} UTC` : '–'}</span></div>
          <div class="row"><span class="k2">${esc(t('as.pv.fix'))}</span><span class="val">${fmtInt(p.nFix)} / ${fmtInt(p.n)}${p.bad ? ` <span class="sub">${esc(t('as.pv.bad', { n: fmtInt(p.bad) }))}</span>` : ''}</span></div>
          <div class="row"><span class="k2">${esc(t('as.pv.alt'))}</span><span class="val">${p.altMin !== null ? `${fmtNum(p.altMin, 0)} / ${fmtNum(p.altMax, 0)} m` : '–'}</span></div>
          ${p.truncated ? `<span class="muted small">${esc(t('as.pv.truncated'))}</span>` : ''}
          <div class="${p.plausible ? 'banner ok' : 'banner warn'}" style="margin-top:8px"><div class="body"><div class="sub">${esc(p.plausible ? t('as.pv.ok') : t('as.pv.notOk'))}</div></div></div></div>
        <svg viewBox="0 0 200 120" width="200" height="120" style="background:#fff;border:1px solid var(--border);border-radius:8px;flex:none"><path d="${p.path}" fill="none" stroke="#1f5fbf" stroke-width="1.5"/></svg></div>
        <p class="muted small">${esc(t('as.pv.mirror'))}</p>`;
    }
    function runPreview() {
      try { preview = previewProfile(text, buildProfile(struct, mapping, meta)); }
      catch (ex) { console.error(ex); preview = { n: 0, nFix: 0, bad: 0, plausible: false, path: '', t0: null, altMin: null }; }
      const box = body.querySelector('[data-preview]'); if (box) box.innerHTML = previewHtml();
      renderHead();
    }

    function renderStep3() {
      const canShare = hasServer() && !!session.code;
      body.innerHTML = `<div class="g2">
          <label class="f">${esc(t('as.name'))}<input class="in" data-meta-text="name" value="${esc(meta.name)}" placeholder="${esc(t('as.namePh'))}" maxlength="80"></label>
          <label class="f">${esc(t('as.manufacturer'))}<input class="in" data-meta-text="manufacturer" value="${esc(meta.manufacturer)}" maxlength="80"></label>
        </div>
        <label class="chk"><input type="checkbox" data-meta-share ${meta.share ? 'checked' : ''} ${canShare ? '' : 'disabled'}> ${esc(t('as.share'))}${canShare ? '' : ` <span class="muted">(${esc(t('as.shareNeedsCode'))})</span>`}</label>
        <div class="infobox"><strong>${esc(t('as.summary'))}</strong><span class="small">${esc(summaryText())}</span></div>
        ${preview && preview.plausible ? '' : `<div class="banner warn"><div class="body"><div class="sub">${esc(t('as.needPreview'))}</div></div></div>`}`;
      body.querySelectorAll('[data-meta-text]').forEach((inp) => inp.addEventListener('input', () => { meta[inp.dataset.metaText] = inp.value; renderHead(); }));
      const sh = body.querySelector('[data-meta-share]'); sh.addEventListener('change', () => { meta.share = sh.checked; });
    }
    function summaryText() {
      const parts = NORM_FIELDS.map((f) => { const m = mapping[f.key] || {}; if (f.key === 'time') return m.col ? `${t('as.f.time')} ← ${m.col}` : m.date ? `${t('as.f.time')} ← ${m.date} + ${m.time}` : null; return m.col ? `${t('as.f.' + f.key)} ← ${m.col}${m.unit ? ' [' + m.unit + ']' : ''}` : null; }).filter(Boolean);
      return parts.join(' · ');
    }

    function render() { renderHead(); if (step === 1) renderStep1(); else if (step === 2) renderStep2(); else renderStep3(); }
    onAct(bg, {
      cancel: () => close(null),
      back: () => { step--; render(); },
      next: () => { if (step === 2 && !preview) runPreview(); step++; render(); },
      preview: () => runPreview(),
      save: async (b) => {
        b.disabled = true;
        try {
          const spec = buildProfile(struct, mapping, { ...meta, name: meta.name.trim(), manufacturer: meta.manufacturer.trim() });
          const rec = await saveProfile(spec, { share: meta.share, code: session.code });
          toast(rec.where === 'shared' ? t('as.savedShared', { name: spec.name }) : t('as.savedLocal', { name: spec.name }));
          close({ ...spec, id: rec.id });
        } catch (ex) { console.error(ex); toast(ex && ex.status === 401 ? t('start.errUnknown') : t('as.saveFailed'), true); b.disabled = false; }
      },
    });
    bg.addEventListener('click', (e) => { if (e.target === bg) close(null); });
    document.body.appendChild(bg);
    render();
  });
}
