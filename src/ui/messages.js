// Meldungen (0.15.8): the messages of this session (toasts, errors) in a window – time, text, copy one or all.
// Balthasar 31.10.2026: system and error messages must stay readable and copyable, not vanish after a few seconds.
import { t } from '../i18n.js';
import { esc, html, onAct, messages, onMessages, clearMessages, copyText, toast, icons, toastLabels } from '../util/dom.js';

const hhmmss = (ms) => new Date(ms).toLocaleTimeString('de-CH', { hour12: false });
let seenAt = 0;   // newest message time the user has seen (badge counts newer errors)
const badges = new Set();

/** Header button with a badge for unread errors; re-renders itself on new messages. */
export function messagesButtonHtml() {
  return `<button type="button" class="msgbtn" data-act="msgs" title="${esc(t('hdr.messages'))}" aria-label="${esc(t('hdr.messages'))}">${icons.messages}<span class="badge" data-msgbadge hidden></span></button>`;
}
export function bindMessagesBadge(root) {
  let off = null;
  const upd = () => {
    if (!root.isConnected && off) { off(); badges.delete(upd); return; }   // header was re-rendered: drop the stale updater
    const b = root.querySelector('[data-msgbadge]'); if (!b) return;
    const n = messages.filter((m) => m.err && m.t > seenAt).length; b.textContent = n > 9 ? '9+' : String(n); b.hidden = n === 0;
  };
  off = onMessages(upd); badges.add(upd); queueMicrotask(upd);
  toastLabels.copy = t('msg.copyOne'); toastLabels.close = t('common.close'); toastLabels.copied = t('common.copied');
}

const allText = () => messages.slice().reverse().map((m) => `${new Date(m.t).toISOString()} ${m.err ? 'FEHLER' : 'INFO'} ${m.text}`).join('\n');

export function openMessages() {
  seenAt = messages[0] ? messages[0].t : Date.now();
  for (const upd of badges) upd();
  const rows = () => (messages.length ? messages.map((m, i) => `<div class="msg ${m.err ? 'err' : ''}"><span class="mono small muted">${hhmmss(m.t)}</span><span class="tx">${esc(m.text)}</span><button type="button" class="tb" data-act="one" data-i="${i}" title="${esc(t('msg.copyOne'))}" aria-label="${esc(t('msg.copyOne'))}">${icons.copy}</button></div>`).join('') : `<p class="muted">${esc(t('msg.none'))}</p>`);
  const bg = html(`<div class="modal-bg"><section class="modal" role="dialog" aria-modal="true" style="max-width:760px">
    <div class="head"><h1>${esc(t('msg.title'))}</h1></div>
    <div class="muted small">${esc(t('msg.hint'))}</div>
    <div class="msglist" data-list>${rows()}</div>
    <div class="foot" style="flex-wrap:wrap"><button class="btn" data-act="clear" type="button">${esc(t('msg.clear'))}</button><button class="btn" data-act="all" type="button" ${messages.length ? '' : 'disabled'}>${esc(t('msg.copyAll'))}</button><button class="btn primary" data-act="close" type="button">${esc(t('common.close'))}</button></div>
  </section></div>`);
  const close = () => { off(); bg.remove(); };
  const off = onMessages(() => { const l = bg.querySelector('[data-list]'); if (l) l.innerHTML = rows(); });
  onAct(bg, {
    close,
    clear: () => { clearMessages(); },
    all: async () => { if (await copyText(allText())) toast(t('common.copied')); },
    one: async (b) => { const m = messages[+b.dataset.i]; if (m && await copyText(m.text)) { b.classList.add('ok'); setTimeout(() => b.classList.remove('ok'), 1500); } },
  });
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
}
