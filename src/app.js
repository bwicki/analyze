// analyze – bootstrap, hash routing, header/action bar, settings panel. Views live in ./ui/*.js.

import { initI18n, setLang, onLangChange, t, currentLang } from './i18n.js';
import { state, bus, PHASES, VERSION, saveSettings, recompute, DEFAULT_SETTINGS } from './state.js';
import { esc, html, toast } from './util/dom.js';
import { renderHeader, renderActionBar, phaseLabel, phaseEnabled } from './ui/header.js';
import { mountImport, importStatus } from './ui/import.js';
import { mountClean, cleanStatus } from './ui/clean.js';
import { mountAnalyze, analyzeStatus } from './ui/analyze.js';
import { mountReport } from './ui/report.js';
import { mountExport } from './ui/export.js';
import { DETECT_DEFAULTS } from './process/detect.js';

const root = document.getElementById('app');
const slots = { header: null, action: null, view: null, footer: null };
let view = null;

const VIEWS = { import: mountImport, clean: mountClean, analyze: mountAnalyze, report: mountReport, export: mountExport };

const ctx = {
  saveSettings,
  refreshBars: () => { renderHeaderBar(); renderAction(); },
  goto: (p) => gotoPhase(p),
};

function phaseFromHash() { const h = location.hash.replace('#', ''); return PHASES.includes(h) ? h : 'import'; }

function gotoPhase(p) {
  if (!PHASES.includes(p)) p = 'import';
  if (!phaseEnabled(p)) { toast(t('nav.needTrack'), true); p = state.track ? 'clean' : 'import'; }
  state.phase = p; state.visited[p] = true;
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
  mountView();
}

function mountView() {
  if (view && view.unmount) view.unmount();
  slots.view.innerHTML = '';
  view = VIEWS[state.phase](slots.view, ctx);
  renderHeaderBar(); renderAction();
  window.scrollTo(0, 0);
}

function renderHeaderBar() {
  const el = renderHeader({ subtitle: t('hdr.subtitle'), onGoto: gotoPhase, onLang: (l) => setLang(l), settingsBody: settingsPanel });
  slots.header.replaceWith(el); slots.header = el;
}

function statusFor(p) {
  if (p === 'import') return importStatus();
  if (p === 'clean') return cleanStatus();
  if (p === 'analyze') return analyzeStatus();
  if (p === 'report') return esc(t('rep.status'));
  if (p === 'export') return esc(t('exp.status'));
  return '';
}

function renderAction() {
  const i = PHASES.indexOf(state.phase);
  const prev = i > 0 ? PHASES[i - 1] : null, next = i < PHASES.length - 1 ? PHASES[i + 1] : null;
  const el = renderActionBar({
    back: prev ? { label: phaseLabel(prev) } : null,
    status: state.busy ? esc(t('imp.busy')) : statusFor(state.phase),
    next: next ? { label: `${t('action.next')} ${phaseLabel(next)}`, disabled: !phaseEnabled(next) || state.busy } : null,
    onBack: () => gotoPhase(prev), onNext: () => gotoPhase(next),
  });
  slots.action.replaceWith(el); slots.action = el;
}

function settingsPanel() {
  const s = state.settings, d = s.detect;
  const num = (key, label, val, unit, step = 1) => `<label class="f">${esc(label)}<div style="display:flex;gap:8px;align-items:center"><input class="in sm" type="number" step="${step}" data-s="${key}" value="${val}" style="width:120px"><span class="muted small">${unit}</span></div></label>`;
  const html_ = `
    <div class="g2">
      <label class="f">${esc(t('settings.units'))}<select class="in sm" data-s="units"><option value="icao" ${s.units !== 'metric' ? 'selected' : ''}>ICAO (ft, kt, m/s)</option><option value="metric" ${s.units === 'metric' ? 'selected' : ''}>${esc(t('settings.metric'))} (m, km/h, m/s)</option></select></label>
      <label class="f">${esc(t('settings.markers'))}<select class="in sm" data-s="markerMin"><option value="15" ${s.markerMin === 15 ? 'selected' : ''}>15 min</option><option value="30" ${s.markerMin === 30 ? 'selected' : ''}>30 min</option><option value="60" ${s.markerMin === 60 ? 'selected' : ''}>60 min</option><option value="180" ${s.markerMin === 180 ? 'selected' : ''}>3 h</option></select></label>
    </div>
    <label class="chk"><input type="checkbox" data-s="geocode" ${s.geocode ? 'checked' : ''}> ${esc(t('settings.geocode'))}</label>
    <details class="exp"><summary>${esc(t('settings.expert'))}</summary><div class="g2" style="padding-top:8px">
      ${num('gapSec', t('settings.gapSec'), s.gapSec, 's')}
      ${num('otherFlightHours', t('settings.otherHours'), s.otherFlightHours, 'h')}
      ${num('detect.windowSec', t('cln.rule.window'), d.windowSec, 's')}
      ${num('detect.trimReserveSec', t('settings.trimReserve'), d.trimReserveSec, 's')}
      ${num('detect.gsAirKt', t('settings.gsAir'), (d.gsAir / 0.514444).toFixed(1), 'kt', 0.1)}
      ${num('detect.vsAir', t('settings.vsAir'), d.vsAir, 'm/s', 0.05)}
      ${num('detect.gsGroundKt', t('settings.gsGround'), (d.gsGround / 0.514444).toFixed(1), 'kt', 0.1)}
      ${num('detect.vsGround', t('settings.vsGround'), d.vsGround, 'm/s', 0.05)}
      ${num('detect.minAirSec', t('settings.minAir'), d.minAirSec, 's')}
      ${num('detect.minGroundSec', t('settings.minGround'), d.minGroundSec, 's')}
    </div><div class="row-wrap" style="gap:8px;padding-bottom:4px"><button class="btn sm" type="button" data-reset>${esc(t('settings.reset'))}</button><span class="muted small">${esc(t('settings.night'))}</span></div></details>
    <div class="muted small">${esc(t('settings.storage'))}</div>`;
  const bind = (body) => {
    body.querySelectorAll('[data-s]').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.s, v = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (k === 'units') s.units = v; else if (k === 'markerMin') s.markerMin = +v; else if (k === 'geocode') s.geocode = v;
      else if (k === 'gapSec') s.gapSec = Math.max(1, +v); else if (k === 'otherFlightHours') s.otherFlightHours = Math.max(0, +v);
      else if (k === 'detect.gsAirKt') d.gsAir = +v * 0.514444; else if (k === 'detect.gsGroundKt') d.gsGround = +v * 0.514444;
      else if (k.startsWith('detect.')) d[k.slice(7)] = +v;
      saveSettings();
      if (state.files.length) recompute({ reclassify: ['gapSec', 'otherFlightHours'].includes(k) });
      else bus.emit('track');
    }));
    const r = body.querySelector('[data-reset]'); if (r) r.addEventListener('click', () => { Object.assign(s, { gapSec: DEFAULT_SETTINGS.gapSec, otherFlightHours: DEFAULT_SETTINGS.otherFlightHours }); s.detect = { ...DETECT_DEFAULTS }; saveSettings(); if (state.files.length) recompute(); toast(t('settings.resetDone')); });
  };
  return { html: html_, bind };
}

function renderFooter() {
  const el = html(`<footer class="app"><span>analyze.wicki.aero · v${VERSION} · ${esc(t('footer.rights'))}</span><span>${esc(t('footer.local'))}</span></footer>`);
  slots.footer.replaceWith(el); slots.footer = el;
}

async function boot() {
  await initI18n();
  root.innerHTML = '';
  slots.header = document.createElement('div'); slots.action = document.createElement('div'); slots.view = document.createElement('div'); slots.footer = document.createElement('div');
  slots.view.style.display = 'contents';
  root.append(slots.header, slots.action, slots.view, slots.footer);
  renderFooter();
  onLangChange(() => { renderHeaderBar(); renderAction(); renderFooter(); mountView(); });
  bus.on('track', () => { renderHeaderBar(); renderAction(); });
  window.addEventListener('hashchange', () => { const p = phaseFromHash(); if (p !== state.phase) gotoPhase(p); });
  gotoPhase(phaseFromHash());
}

boot().catch((e) => { root.innerHTML = `<p style="padding:20px;color:#c0392b">Start failed: ${esc(e.message)}</p>`; console.error(e); });
