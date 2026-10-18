// Header (brand, phase chips, logo, DE/EN, ☰ settings) and the action bar. Pure rendering; app.js wires callbacks.

import { t, currentLang } from '../i18n.js';
import { esc, html, icons, onAct } from '../util/dom.js';
import { state, PHASES, VERSION } from '../state.js';
import { session, logoUrl, DEFAULT_LOGO, hasServer } from '../session.js';

const PHASE_KEYS = { import: 'phase.import', clean: 'phase.clean', analyze: 'phase.analyze', report: 'phase.report', export: 'phase.export' };
export function phaseLabel(p) { return t(PHASE_KEYS[p]); }

/** Which phases can be opened right now (viewer mode: only Auswerten and Bericht). */
export function phaseEnabled(p) {
  if (state.viewer) return (p === 'analyze' || p === 'report') && !!state.stats;
  if (p === 'import') return true;
  if (p === 'clean') return !!state.track;
  return !!state.stats;
}

function phaseChips(current) {
  const cur = PHASES.indexOf(current);
  return PHASES.map((p, i) => {
    const done = i < cur && phaseEnabled(p) && state.visited[p];
    const cls = ['ph', p === current ? 'active' : '', done ? 'done' : ''].join(' ');
    return `<button type="button" class="${cls}" data-act="goto" data-phase="${p}" ${phaseEnabled(p) ? '' : 'disabled'}><span class="n">${done ? '✓' : i + 1}</span>${esc(phaseLabel(p))}</button>`;
  }).join('');
}

/** Logo of the Kennung in use (or of the flight's owner in viewer mode), default Ballonteam logo otherwise. */
function logoImg(height = 46) {
  const owner = state.viewer && state.viewer.owner;
  const src = owner ? logoUrl(owner.code, owner.logo) : logoUrl(session.code, session.me && session.me.logo);
  return `<img src="${esc(src)}" alt="Logo" style="height:${height}px;width:auto;max-width:220px;object-fit:contain" onerror="this.onerror=null;this.src='${DEFAULT_LOGO}'">`;
}

/** o: {subtitle, onGoto, onLang, onNav(view), settingsBody(): {html, bind}} */
export function renderHeader(o) {
  const lang = currentLang();
  const v = state.viewer;
  const who = v ? `<span class="pill sm viewer"><span class="dot b"></span>${esc(t('hdr.viewer'))}${v.owner && v.owner.displayName ? ` · ${esc(v.owner.displayName)}` : ''}</span>`
    : session.code ? `<button type="button" class="pill sm who" data-act="nav" data-view="flights" title="${esc(t('hdr.myFlights'))}"><span class="dot g"></span><span class="mono">${esc(session.code)}</span>${session.me && session.me.displayName ? ` · ${esc(session.me.displayName)}` : ''}</button>`
    : hasServer() ? `<button type="button" class="pill sm who" data-act="nav" data-view="start"><span class="dot x"></span>${esc(t('hdr.noCode'))}</button>` : '';
  const nav = v ? `<nav class="phases" aria-label="${esc(t('hdr.phases'))}"><span class="ph active"><span class="n">▶</span>${esc(v.title || t('hdr.viewer'))}</span>${PHASES.filter((p) => p === 'analyze' || p === 'report').map((p) => `<button type="button" class="ph ${p === state.phase ? 'active' : ''}" data-act="goto" data-phase="${p}">${esc(phaseLabel(p))}</button>`).join('')}</nav>`
    : `<nav class="phases" aria-label="${esc(t('hdr.phases'))}">${phaseChips(state.phase)}${['start', 'flights', 'admin'].includes(state.phase) ? `<span class="ph active"><span class="n">·</span>${esc(t('view.' + state.phase))}</span>` : ''}</nav>`;
  const el = html(`<header class="top">
    <div class="brand"><strong>analyze</strong><span>${esc(o.subtitle || t('hdr.subtitle'))}</span></div>
    ${nav}
    <div class="right">${logoImg()}<div class="tools">
      ${who}
      <div class="seg lang" aria-label="${esc(t('hdr.language'))}"><button type="button" data-act="lang" data-lang="de" class="${lang === 'de' ? 'on' : ''}">DE</button><button type="button" data-act="lang" data-lang="en" class="${lang === 'en' ? 'on' : ''}">EN</button></div>
      <details class="menu"><summary aria-label="${esc(t('hdr.menu'))}" title="${esc(t('hdr.menu'))}">${icons.menu}</summary><div class="panel"><h3>${esc(t('settings.title'))} · v${VERSION}</h3><div class="body"></div></div></details>
    </div></div>
  </header>`);
  onAct(el, { goto: (b) => o.onGoto && o.onGoto(b.dataset.phase), lang: (b) => o.onLang && o.onLang(b.dataset.lang), nav: (b) => o.onNav && o.onNav(b.dataset.view) });
  const details = el.querySelector('details.menu');
  const fill = () => { const s = o.settingsBody(); const body = details.querySelector('.body'); body.innerHTML = s.html; if (s.bind) s.bind(body, details); };
  details.addEventListener('toggle', () => { if (details.open) fill(); });
  document.addEventListener('click', (e) => { if (details.open && !details.contains(e.target)) details.open = false; });
  return el;
}

/** o: {back:{label}|null, status(html), next:{label, disabled}|null, extra(html), onBack, onNext, onExtra} */
export function renderActionBar(o) {
  const el = html(`<div class="actionbar">
    ${o.back ? `<button class="btn" type="button" data-act="back">← ${esc(o.back.label)}</button>` : '<span></span>'}
    <span class="status">${o.status || ''}</span>
    ${o.extra || ''}
    ${o.next ? `<button class="btn primary" type="button" data-act="next" ${o.next.disabled ? 'disabled' : ''}>${esc(o.next.label)} →</button>` : ''}
  </div>`);
  onAct(el, { back: () => o.onBack && o.onBack(), next: () => o.onNext && o.onNext(), ...(o.acts || {}) });
  return el;
}
