// Header (brand, phase chips, logo, DE/EN, ☰ settings) and the action bar. Pure rendering; app.js wires callbacks.

import { t, currentLang } from '../i18n.js';
import { esc, html, icons, onAct } from '../util/dom.js';
import { state, PHASES, VERSION } from '../state.js';

const PHASE_KEYS = { import: 'phase.import', clean: 'phase.clean', analyze: 'phase.analyze', report: 'phase.report', export: 'phase.export' };
export function phaseLabel(p) { return t(PHASE_KEYS[p]); }

/** Which phases can be opened right now. */
export function phaseEnabled(p) {
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

/** o: {subtitle, onGoto, onLang, settingsBody(): {html, bind}} */
export function renderHeader(o) {
  const lang = currentLang();
  const el = html(`<header class="top">
    <div class="brand"><strong>analyze</strong><span>${esc(o.subtitle || t('hdr.subtitle'))}</span></div>
    <nav class="phases" aria-label="${esc(t('hdr.phases'))}">${phaseChips(state.phase)}</nav>
    <div class="right"><img src="./img/logo.png" alt="Wicki Partners Ballonteam"><div class="tools">
      <div class="seg lang" aria-label="${esc(t('hdr.language'))}"><button type="button" data-act="lang" data-lang="de" class="${lang === 'de' ? 'on' : ''}">DE</button><button type="button" data-act="lang" data-lang="en" class="${lang === 'en' ? 'on' : ''}">EN</button></div>
      <details class="menu"><summary aria-label="${esc(t('hdr.menu'))}" title="${esc(t('hdr.menu'))}">${icons.menu}</summary><div class="panel"><h3>${esc(t('settings.title'))} · v${VERSION}</h3><div class="body"></div></div></details>
    </div></div>
  </header>`);
  onAct(el, { goto: (b) => o.onGoto && o.onGoto(b.dataset.phase), lang: (b) => o.onLang && o.onLang(b.dataset.lang) });
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
