// analyze – bootstrap, hash routing, header/action bar, settings panel. Views live in ./ui/*.js.
// Routes: #start (Kennung), #import … #export (the five phases), #flights (Meine Fahrten), #admin
// (Supermaster); ?v=<id> opens a saved flight read-only (short link analyze.wicki.aero/v/<id> → 404.html → here).

import { initI18n, setLang, onLangChange, t, currentLang } from './i18n.js';
import { state, bus, PHASES, VERSION, saveSettings, recompute, DEFAULT_SETTINGS } from './state.js';
import { esc, html, toast, confirmDialog } from './util/dom.js';
import { renderHeader, renderActionBar, phaseLabel, phaseEnabled } from './ui/header.js';
import { mountImport, importStatus } from './ui/import.js';
import { mountClean, cleanStatus } from './ui/clean.js';
import { mountAnalyze, analyzeStatus } from './ui/analyze.js';
import { mountReport } from './ui/report.js';
import { mountExport } from './ui/export.js';
import { mountStart } from './ui/start.js';
import { mountFlights } from './ui/flights.js';
import { mountAdmin } from './ui/admin.js';
import { DETECT_DEFAULTS } from './process/detect.js';
import { session, hasAccess, hasServer, setMe, clearSession } from './session.js';
import { api, ApiError } from './api.js';
import { openFlight } from './flightio.js';
import { refreshSharedProfiles } from './profiles-store.js';
import { loadTerrain } from './terrain/store.js';
import { maybeShowWelcome, showWelcome } from './ui/welcome.js';
import { showLegal } from './ui/legal.js';

function applyDocumentTitle() { if (!state.viewer) document.title = t('hdr.title'); }

const root = document.getElementById('app');
const slots = { header: null, action: null, view: null, footer: null };
let view = null;

const EXTRA = ['start', 'flights', 'admin'];
const VIEWS = { import: mountImport, clean: mountClean, analyze: mountAnalyze, report: mountReport, export: mountExport, start: mountStart, flights: mountFlights, admin: mountAdmin };

const ctx = {
  saveSettings,
  refreshBars: () => { renderHeaderBar(); renderAction(); },
  goto: (p) => gotoPhase(p),
};

function phaseFromHash() { const h = location.hash.replace('#', ''); return PHASES.includes(h) || EXTRA.includes(h) ? h : null; }

function gotoPhase(p) {
  if (!PHASES.includes(p) && !EXTRA.includes(p)) p = 'import';
  if (p === 'flights' && !session.code) p = 'start';
  if (p === 'start' && (state.viewer || !hasServer())) p = state.stats ? 'analyze' : 'import';
  if (p === 'import' && !state.viewer && !hasAccess() && hasServer()) p = 'start';
  if (PHASES.includes(p) && !phaseEnabled(p)) { toast(t('nav.needTrack'), true); p = state.viewer ? 'analyze' : state.track ? 'clean' : 'import'; }
  state.phase = p; state.visited[p] = true;
  if (location.hash !== '#' + p) history.replaceState(null, '', location.search + '#' + p);
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
  const el = renderHeader({ subtitle: t('hdr.subtitle'), onGoto: gotoPhase, onLang: (l) => setLang(l), onNav: (v) => gotoPhase(v), onLogout: logout, settingsBody: settingsPanel });
  slots.header.replaceWith(el); slots.header = el;
}

function statusFor(p) {
  if (p === 'import') return importStatus();
  if (p === 'clean') return cleanStatus();
  if (p === 'analyze') return analyzeStatus();
  if (p === 'report') return esc(t('rep.status'));
  if (p === 'export') return esc(t('exp.status'));
  if (p === 'start') return esc(t('start.status'));
  if (p === 'flights') return esc(t('fl.status'));
  if (p === 'admin') return esc(t('adm.status'));
  return '';
}

function renderAction() {
  const seq = state.viewer ? ['analyze', 'report'] : PHASES;
  const i = seq.indexOf(state.phase);
  const prev = i > 0 ? seq[i - 1] : null, next = i >= 0 && i < seq.length - 1 ? seq[i + 1] : null;
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
      <label class="f">${esc(t('settings.markers'))}<select class="in sm" data-s="markerMin"><option value="auto" ${s.markerMin === 'auto' ? 'selected' : ''}>${esc(t('ana.markerAuto'))}</option><option value="10" ${s.markerMin === 10 ? 'selected' : ''}>10 min</option><option value="15" ${s.markerMin === 15 ? 'selected' : ''}>15 min</option><option value="30" ${s.markerMin === 30 ? 'selected' : ''}>30 min</option><option value="60" ${s.markerMin === 60 ? 'selected' : ''}>60 min</option><option value="180" ${s.markerMin === 180 ? 'selected' : ''}>3 h</option></select></label>
    </div>
    <label class="chk"><input type="checkbox" data-s="geocode" ${s.geocode ? 'checked' : ''}> ${esc(t('settings.geocode'))}</label>
    <label class="chk"><input type="checkbox" data-s="terrain" ${s.terrain !== false ? 'checked' : ''}> ${esc(t('settings.terrain'))}</label>
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
    <div class="muted small">${esc(t('settings.storage'))}</div>
    <div class="row-wrap" style="gap:8px"><button class="btn sm" type="button" data-welcome>${esc(t('settings.welcome'))}</button><button class="btn sm" type="button" data-legal>${esc(t('settings.legal'))}</button></div>
    ${hasServer() && !state.viewer ? `<div class="row-wrap" style="gap:8px"><button class="btn sm" type="button" data-nav="start">${esc(session.code ? t('settings.changeCode') : t('settings.toStart'))}</button><button class="btn sm" type="button" data-nav="admin">${esc(t('settings.admin'))}</button></div>` : ''}`;
  const bind = (body, details) => {
    body.querySelectorAll('[data-s]').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.s, v = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (k === 'units') s.units = v; else if (k === 'markerMin') { s.markerMin = v === 'auto' ? 'auto' : +v; s.markerTouched = true; } else if (k === 'geocode') s.geocode = v; else if (k === 'terrain') { s.terrain = v; saveSettings(); loadTerrain(true); return; }
      else if (k === 'gapSec') s.gapSec = Math.max(1, +v); else if (k === 'otherFlightHours') s.otherFlightHours = Math.max(0, +v);
      else if (k === 'detect.gsAirKt') d.gsAir = +v * 0.514444; else if (k === 'detect.gsGroundKt') d.gsGround = +v * 0.514444;
      else if (k.startsWith('detect.')) d[k.slice(7)] = +v;
      saveSettings();
      if (state.files.length) recompute({ reclassify: ['gapSec', 'otherFlightHours'].includes(k) });
      else bus.emit('track');
    }));
    const r = body.querySelector('[data-reset]'); if (r) r.addEventListener('click', () => { Object.assign(s, { gapSec: DEFAULT_SETTINGS.gapSec, otherFlightHours: DEFAULT_SETTINGS.otherFlightHours }); s.detect = { ...DETECT_DEFAULTS }; saveSettings(); if (state.files.length) recompute(); toast(t('settings.resetDone')); });
    body.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { details.open = false; gotoPhase(b.dataset.nav); }));
    const w = body.querySelector('[data-welcome]'); if (w) w.addEventListener('click', () => { details.open = false; showWelcome(); });
    const lg = body.querySelector('[data-legal]'); if (lg) lg.addEventListener('click', () => { details.open = false; showLegal(); });
  };
  return { html: html_, bind };
}

function renderFooter() {
  const el = html(`<footer class="app"><span>analyze.wicki.aero · v${VERSION} · ${esc(t('footer.rights'))} · <a href="#" data-legal>${esc(t('footer.legal'))}</a></span><span>${esc(hasServer() ? t('footer.server') : t('footer.local'))}</span></footer>`);
  el.querySelector('[data-legal]').addEventListener('click', (e) => { e.preventDefault(); showLegal(); });
  slots.footer.replaceWith(el); slots.footer = el;
}

/** ?v=<id>: load a saved flight read-only. Returns true when handled. */
async function loadViewer() {
  const q = new URLSearchParams(location.search), id = q.get('v');
  if (!id || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(id.toUpperCase())) return false;
  if (!hasServer()) return false;
  const pdf = q.get('pdf') === '1';   // 0.13.0: opened by the Worker's PDF renderer → straight to the report, flags readiness on <html>
  if (pdf) document.documentElement.classList.add('pdf');
  slots.view.innerHTML = `<main class="page"><div class="banner info"><div class="body"><h3>${esc(t('viewer.loading'))}</h3></div></div></main>`;
  try {
    const rec = await api.view.get(id.toUpperCase());
    const [text, eventRows] = await Promise.all([api.view.track(id.toUpperCase()), rec.hasEvents ? api.view.events(id.toUpperCase()).catch(() => null) : null]);
    await openFlight({ ...rec, url: location.origin + location.pathname.replace(/\/$/, '') + '/v/' + rec.id }, text, { viewer: true, eventRows });
    document.title = `${rec.title ? rec.title + ' – ' : ''}${t('hdr.title')}`;
    gotoPhase(pdf ? 'report' : 'analyze');
  } catch (ex) {
    console.error(ex);
    state.viewer = null;
    slots.view.innerHTML = `<main class="page"><div class="banner warn"><div class="body"><h3>${esc(ex instanceof ApiError && ex.status === 404 ? t('viewer.notFound') : t('start.errNetwork'))}</h3><div class="sub"><a href="./">${esc(t('viewer.toApp'))}</a></div></div></div></main>`;
    renderHeaderBar(); renderAction();
  }
  return true;
}

/** Logout (0.15.4): removes the PIN from this browser after a confirmation; the flights stay on the server. */
async function logout() {
  const ok = await confirmDialog({ title: t('fl.logout'), text: esc(t('fl.logoutNote')), okLabel: t('fl.logout'), cancelLabel: t('common.cancel') });
  if (!ok) return;
  clearSession(); state.flight = null; renderHeaderBar(); renderAction(); gotoPhase('start'); toast(t('hdr.loggedOut'));
}

/** Refresh the stored Kennung in the background (display name, logo, blocked?). */
async function refreshMe() {
  if (!session.code || !hasServer()) return;
  try { setMe(await api.me.get()); renderHeaderBar(); }
  catch (ex) { if (ex instanceof ApiError && (ex.status === 401 || ex.status === 403)) { clearSession(); toast(t(ex.status === 403 ? 'start.errBlocked' : 'start.errUnknown'), true); renderHeaderBar(); if (!state.viewer) gotoPhase('start'); } }
}

async function boot() {
  await initI18n(); applyDocumentTitle();
  root.innerHTML = '';
  slots.header = document.createElement('div'); slots.action = document.createElement('div'); slots.view = document.createElement('div'); slots.footer = document.createElement('div');
  slots.view.style.display = 'contents';
  root.append(slots.header, slots.action, slots.view, slots.footer);
  renderFooter(); renderHeaderBar(); renderAction();
  onLangChange(() => { applyDocumentTitle(); renderHeaderBar(); renderAction(); renderFooter(); mountView(); });
  bus.on('track', () => { renderHeaderBar(); renderAction(); });
  bus.on('flight', () => { renderHeaderBar(); });
  window.addEventListener('hashchange', () => { const p = phaseFromHash(); if (p && p !== state.phase) gotoPhase(p); });
  refreshSharedProfiles();
  if (await loadViewer()) return;
  const wanted = phaseFromHash();
  gotoPhase(wanted || (hasServer() && !hasAccess() ? 'start' : 'import'));
  refreshMe();
  maybeShowWelcome();   // first visit: what the site does, personalisation after the PIN (0.8.7)
}

boot().catch((e) => { root.innerHTML = `<p style="padding:20px;color:#c0392b">Start failed: ${esc(e.message)}</p>`; console.error(e); });
