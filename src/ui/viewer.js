// Full-screen viewer (0.9.1): any graphic – map, 3D view, profile, timeline, detail map, preview image,
// numeric record – opens large in an overlay with a close button top right (Esc or click outside also close).
// Interactive graphics are moved into the viewer (adopt) and put back on close, so their state survives;
// static ones are rendered anew into the viewer body.

import { esc, html, onAct, icons } from '../util/dom.js';
import { t } from '../i18n.js';

export const EXPAND_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
export const LIST_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>';

const stack = [];   // open viewers (top-most last)

/** Expand button for the corner of a graphic (inside a .gfx wrapper); extra = further attributes. */
export function expandBtn(extra = '') {
  return `<button type="button" class="xpand noprint" data-act="expand" ${extra} title="${esc(t('vw.expand'))}" aria-label="${esc(t('vw.expand'))}">${EXPAND_ICON}</button>`;
}

/**
 * Open a viewer. title/sub/tools are HTML (callers escape their text). Returns
 * {el, body, close(), onClose(fn), setTitle(html), setSub(html)}; cls: 'fill' (body without padding, for a map).
 */
export function openViewer({ title = '', sub = '', tools = '', cls = '', onClose = null } = {}) {
  const el = html(`<div class="viewer-bg" role="dialog" aria-modal="true" aria-label="${esc(String(title).replace(/<[^>]+>/g, ''))}">
    <section class="viewer ${esc(cls)}">
      <div class="vhead"><div class="vtitle"><h1 data-vtitle>${title}</h1><span class="muted small" data-vsub ${sub ? '' : 'hidden'}>${sub}</span></div>
        ${tools ? `<div class="vtools">${tools}</div>` : ''}<button type="button" class="vx" data-act="vclose" title="${esc(t('vw.close'))}" aria-label="${esc(t('vw.close'))}">${icons.close}</button></div>
      <div class="vbody" data-vbody></div>
    </section></div>`);
  const body = el.querySelector('[data-vbody]');
  const closers = onClose ? [onClose] : [];
  let closed = false;
  const v = {
    el, body,
    onClose(fn) { closers.push(fn); },
    close() { if (closed) return; closed = true; const k = stack.indexOf(v); if (k >= 0) stack.splice(k, 1); el.remove(); if (!stack.length) document.body.classList.remove('viewer-open'); for (const fn of closers) { try { fn(); } catch (e) { console.warn('viewer close', e); } } },
    setTitle(h) { el.querySelector('[data-vtitle]').innerHTML = h; },
    setSub(h) { const s = el.querySelector('[data-vsub]'); s.innerHTML = h; s.hidden = !h; },
  };
  onAct(el, { vclose: () => v.close() });
  el.addEventListener('click', (e) => { if (e.target === el) v.close(); });
  el.style.zIndex = String(130 + stack.length);
  stack.push(v);
  document.body.classList.add('viewer-open');
  document.body.appendChild(el);
  el.querySelector('.vx').focus();
  return v;
}

// Esc closes the top-most viewer
if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); } });

/** Move node into box (a placeholder keeps its place); returns the function that puts it back. */
export function adopt(node, box) {
  const ph = document.createComment('viewer');
  node.parentNode.insertBefore(ph, node);
  box.appendChild(node); node.classList.add('in-viewer');
  return () => { node.classList.remove('in-viewer'); if (ph.parentNode) ph.replaceWith(node); else node.remove(); };
}

/**
 * A box inside the viewer body sized to the largest width at which a graphic of the given aspect ratio
 * (width / height) still fits the body without scrolling; follows resizes while the viewer is open.
 */
export function fitBox(v, aspect) {
  const box = document.createElement('div'); box.className = 'vfit'; v.body.appendChild(box);
  const size = () => { const bw = v.body.clientWidth - 2, bh = v.body.clientHeight - 2; if (bw <= 0 || bh <= 0) return; box.style.width = `${Math.max(240, Math.min(bw, bh * aspect))}px`; };
  size();
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(size); ro.observe(v.body); v.onClose(() => ro.disconnect()); }
  return box;
}

/** fn() on a plain click (no drag, no long press) on el – for graphics that may also be dragged (maps). */
export function onPlainClick(el, fn) {
  let down = null;
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0 || (e.target.closest && e.target.closest('button, a, input, select, .leaflet-control'))) { down = null; return; } down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  el.addEventListener('pointerup', (e) => { if (!down) return; const d = down; down = null; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && Date.now() - d.t < 500) fn(e); });
  el.addEventListener('pointercancel', () => { down = null; });
}

/** True while at least one viewer is open. */
export function viewerOpen() { return stack.length > 0; }
