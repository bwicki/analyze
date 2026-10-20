// Start · Kennung (design board "Main"): continue with a Kennung, try without one, or create a new one.
// A Kennung is the only credential (concept decision 4) – it is shown once when created.

import { t, tx, currentLang } from '../i18n.js';
import { esc, html, onAct, toast, copyText } from '../util/dom.js';
import { state } from '../state.js';
import { api, ApiError } from '../api.js';
import { session, setCode, setGuest, hasServer } from '../session.js';

const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
export const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function mountStart(root, ctx) {
  const el = html(`<main class="page start">
    <div class="row-wrap" style="align-items:stretch">
      <section class="card" style="flex:1 1 360px">
        <h2>${esc(t('start.withCode'))}</h2>
        <p class="small">${esc(t('start.withCodeSub'))}</p>
        <form data-form-open class="col" style="gap:10px">
          <label class="f">${esc(t('start.code'))}<input class="in mono code" data-code autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="KQZMWB" value="${esc(session.code || '')}"></label>
          <div class="err hidden" data-err></div>
          <button class="btn primary big" type="submit" data-open>${esc(t('start.open'))} →</button>
        </form>
        <button class="btn" type="button" data-act="guest">${esc(t('start.guest'))}</button>
        <span class="muted small">${esc(t('start.guestSub'))}</span>
      </section>
      <section class="card" style="flex:1 1 360px">
        <h2>${esc(t('start.newCode'))}</h2>
        <p class="small">${esc(t('start.newCodeSub'))}</p>
        <label class="f">${esc(t('start.displayName'))}<input class="in" data-name maxlength="60" placeholder="${esc(t('start.displayNamePh'))}"></label>
        <div data-created class="hidden">
          <div class="codebox"><span class="mono" data-newcode></span><button class="btn sm" type="button" data-act="copy">${esc(t('start.copy'))}</button></div>
          <div class="banner warn" style="margin-top:10px"><div class="body"><h3>${esc(t('start.noteIt'))}</h3><div class="sub">${esc(t('start.noteItSub'))}</div></div></div>
          <button class="btn primary big" type="button" data-act="useNew" style="margin-top:10px;width:100%">${esc(t('start.useNew'))} →</button>
        </div>
        <button class="btn" type="button" data-act="create">${esc(t('start.create'))}</button>
      </section>
      <section class="card" style="flex:1 1 300px">
        <h2>${esc(t('start.how'))}</h2>
        <ol class="steps">
          <li><strong>${esc(t('phase.import'))}</strong> – ${esc(t('start.s1'))}</li>
          <li><strong>${esc(t('phase.clean'))}</strong> – ${esc(t('start.s2'))}</li>
          <li><strong>${esc(t('phase.analyze'))}</strong> – ${esc(t('start.s3'))}</li>
          <li><strong>${esc(t('phase.report'))}</strong> – ${esc(t('start.s4'))}</li>
          <li><strong>${esc(t('phase.export'))}</strong> – ${esc(t('start.s5'))}</li>
        </ol>
        <h2>${esc(t('start.formats'))}</h2>
        <p class="small">${esc(t('start.formatsSub')).replace('{mail}', '<a href="mailto:balthasar@wicki.aero">balthasar@wicki.aero</a>')}</p>
        <p class="muted small">${esc(t('start.privacy'))}</p>
      </section>
    </div>
    ${hasServer() ? '' : `<div class="banner info"><div class="body"><h3>${esc(t('start.noServer'))}</h3></div></div>`}
  </main>`);

  const codeIn = el.querySelector('[data-code]'), err = el.querySelector('[data-err]');
  const showErr = (msg) => { err.textContent = msg; err.classList.toggle('hidden', !msg); };
  codeIn.addEventListener('input', () => { const p = codeIn.selectionStart; codeIn.value = normCode(codeIn.value); codeIn.setSelectionRange(p, p); showErr(''); });

  el.querySelector('[data-form-open]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normCode(codeIn.value);
    if (!CODE_RE.test(code)) { showErr(t('start.errFormat')); return; }
    if (!hasServer()) { showErr(t('start.noServer')); return; }
    const btn = el.querySelector('[data-open]'); btn.disabled = true;
    try {
      const me = await api.me.get(code);
      setCode(code, me);
      toast(t('start.welcome', { name: me.displayName || code }));
      ctx.refreshBars(); ctx.goto(state.track ? 'analyze' : (me.flights ? 'flights' : 'import'));
    } catch (ex) {
      showErr(ex instanceof ApiError && ex.status === 401 ? t('start.errUnknown') : ex instanceof ApiError && ex.status === 403 ? t('start.errBlocked') : t('start.errNetwork'));
    } finally { btn.disabled = false; }
  });

  let created = null;
  onAct(el, {
    guest: () => { setGuest(); ctx.refreshBars(); ctx.goto(state.track ? 'analyze' : 'import'); },
    create: async (b) => {
      if (!hasServer()) { toast(t('start.noServer'), true); return; }
      b.disabled = true;
      try {
        created = await api.codes.create(el.querySelector('[data-name]').value.trim(), currentLang(), state.settings.units);
        el.querySelector('[data-newcode]').textContent = created.code;
        el.querySelector('[data-created]').classList.remove('hidden'); b.classList.add('hidden');
      } catch (ex) { toast(ex.status === 429 ? t('start.errTooMany') : t('start.errNetwork'), true); b.disabled = false; }
    },
    copy: async () => { if (created && await copyText(created.code)) toast(t('common.copied')); },
    useNew: async () => {
      if (!created) return;
      try { setCode(created.code, await api.me.get(created.code)); } catch { setCode(created.code, { code: created.code, displayName: created.displayName, flights: 0 }); }
      ctx.refreshBars(); ctx.goto(state.track ? 'export' : 'import');
    },
  });
  root.appendChild(el);
  setTimeout(() => { if (!session.code) codeIn.focus(); }, 50);
  return { unmount: () => {} };
}
