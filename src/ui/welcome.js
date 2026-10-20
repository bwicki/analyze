// First visit (0.8.7): a small window explains what the site does and that the app can be personalised
// (own logo, team name) once a PIN exists. Shown once per browser (localStorage), closes itself after
// 6 s – the countdown stops while the pointer is over the window or the language is switched. DE/EN inside.

import { t, setLang, currentLang } from '../i18n.js';
import { esc, html } from '../util/dom.js';
import { state } from '../state.js';

const LS_KEY = 'analyze.welcomed';
const SHOW_MS = 6000;

export function maybeShowWelcome() {
  if (state.viewer) return false;
  try { if (localStorage.getItem(LS_KEY)) return false; } catch { /* private mode: show every time */ }
  try { localStorage.setItem(LS_KEY, String(Date.now())); } catch { /* ignore */ }
  showWelcome();
  return true;
}

export function showWelcome() {
  const bg = html(`<div class="welcome-bg" role="dialog" aria-modal="true" aria-label="${esc(t('wel.title'))}"><section class="welcome">
      <div class="head"><h1>${esc(t('wel.title'))}</h1><div class="seg sm" data-wlang><button type="button" data-lang="de" class="${currentLang() === 'de' ? 'on' : ''}">DE</button><button type="button" data-lang="en" class="${currentLang() === 'en' ? 'on' : ''}">EN</button></div></div>
      <p data-w1>${esc(t('wel.p1'))}</p>
      <p data-w2>${esc(t('wel.p2'))}</p>
      <div class="foot"><span class="bar"><span data-bar></span></span><button class="btn primary sm" type="button" data-close>${esc(t('wel.ok'))}</button></div>
    </section></div>`);
  const bar = bg.querySelector('[data-bar]');
  let remaining = SHOW_MS, last = performance.now(), paused = false, raf = 0;
  const close = () => { cancelAnimationFrame(raf); bg.remove(); };
  const tick = (now) => {
    if (!paused) remaining -= now - last; last = now;
    bar.style.width = `${Math.max(0, remaining / SHOW_MS * 100)}%`;
    if (remaining <= 0) { close(); return; }
    raf = requestAnimationFrame(tick);
  };
  const retext = () => { bg.querySelector('h1').textContent = t('wel.title'); bg.querySelector('[data-w1]').textContent = t('wel.p1'); bg.querySelector('[data-w2]').textContent = t('wel.p2'); bg.querySelector('[data-close]').textContent = t('wel.ok'); bg.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === currentLang())); };
  bg.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', async () => { await setLang(b.dataset.lang); retext(); remaining = Math.max(remaining, SHOW_MS); }));   // switching gives the full time again
  bg.querySelector('[data-close]').addEventListener('click', close);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.querySelector('.welcome').addEventListener('pointerenter', () => { paused = true; });
  bg.querySelector('.welcome').addEventListener('pointerleave', () => { paused = false; });
  document.body.appendChild(bg);
  raf = requestAnimationFrame(tick);
  return close;
}
