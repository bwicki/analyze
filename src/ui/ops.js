// Übergabe an ops.wicki.aero (0.10.0, shared since 0.15.6): used by the report's Spezialfunktionen and by step 5 · card 5.
// The Worker lists the last 20 briefings (decision 20.10.2026: always a list, no automatic match), the user picks one,
// the Worker sends track + Kennzahlen + Stammdaten + viewer link with the service token – the browser never sees it.
import { t } from '../i18n.js';
import { esc, html, onAct, toast } from '../util/dom.js';
import { fmtDateUTC, fmtDateTimeUTC } from '../util/format.js';
import { state, saveMeta } from '../state.js';
import { session } from '../session.js';
import { api } from '../api.js';

/** Who may hand over: PINs the Supermaster flagged as team, or the Supermaster token itself (the Worker checks the same). */
export const canOpsHandover = () => !state.viewer && (!!(session.me && session.me.team) || !!session.adminToken);

/** Status line under the handover button: save first / last handover / ready. */
export function opsStateHtml() {
  const h = state.meta.opsHandover;
  if (!canOpsHandover()) return esc(t('exp.opsNeedTeam'));
  if (!state.flight || !state.flight.id) return esc(t('rep.opsSaveFirst'));
  if (h && h.briefingId) return `${esc(t('rep.opsLast', { no: h.no || h.briefingId, date: fmtDateTimeUTC(h.at || Date.now()) }))}${h.url ? ` · <a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(t('rep.opsOpen'))}</a>` : ''}`;
  return esc(t('rep.opsReady'));
}

/**
 * Übergabe an ops.wicki.aero (0.10.0): the Worker lists the last 20 briefings (decision 20.10.2026: always a list,
 * no automatic match), the user picks one, the Worker sends track + Kennzahlen + Stammdaten + viewer link.
 */
export async function openOpsHandover({ onDone } = {}) {
  if (!state.flight || !state.flight.id) { toast(t('rep.opsSaveFirst'), true); return; }
  let list;
  try { list = await api.flights.opsBriefings(state.flight.id); } catch (e) { toast(t('rep.opsListFailed', { err: e.message || '' }), true); return; }
  const brs = list.briefings || [];
  const dateOf = (b) => (Number.isFinite(b.startMs) ? fmtDateUTC(b.startMs) : '–');
  // preselect the briefing this flight was handed to before (0.15.7), otherwise the newest one
  const prev = state.meta.opsHandover && state.meta.opsHandover.briefingId;
  const pre = brs.some((b) => b.id === prev) ? prev : (brs[0] ? brs[0].id : '');
  let rows = brs.map((b) => `<label class="dl" style="cursor:pointer"><input type="radio" name="opsb" value="${esc(b.id)}" ${b.id === pre ? 'checked' : ''}><div class="t"><strong>${esc(b.no || b.id)} · ${dateOf(b)} · ${esc(b.site || b.icao || '–')}</strong><span>${esc([b.reg, b.balloon, b.kind, b.status].filter(Boolean).join(' · '))}${b.trajectory ? ` · <span class="ok">✓ ${esc(t('rep.opsHas', { date: fmtDateTimeUTC(Date.parse(b.trajectory.receivedAt) || Date.now()) }))}</span>` : ''}</span></div></label>`).join('');
  // «Neue Fahrt ohne Briefing» (0.15.7): only once ops offers it (canCreate) – ops creates the Stammdaten, the briefing part stays empty
  if (list.canCreate) rows += `<label class="dl" style="cursor:pointer"><input type="radio" name="opsb" value="new" ${pre ? '' : 'checked'}><div class="t"><strong>＋ ${esc(t('rep.opsNew'))}</strong><span>${esc(t('rep.opsNewHint'))}</span></div></label>`;
  const bg = html(`<div class="modal-bg"><section class="modal" role="dialog" aria-modal="true" style="max-width:720px">
    <div class="head"><h1>${esc(t('rep.opsPick'))}</h1></div>
    <div class="muted small">${esc(t('rep.opsPickSub', { title: state.flight.title || state.meta.title || state.flight.id }))}</div>
    <div class="dl-list" style="max-height:min(50vh,420px);overflow:auto">${rows || `<p class="muted">${esc(t('rep.opsNone'))}</p>`}</div>
    <div class="foot"><button class="btn" data-act="cancel" type="button">${esc(t('common.cancel'))}</button><button class="btn primary" data-act="send" type="button" ${rows ? '' : 'disabled'}>${esc(t('rep.opsSend'))}</button></div>
  </section></div>`);
  const close = () => bg.remove();
  onAct(bg, {
    cancel: close,
    send: async (btn) => {
      const sel = bg.querySelector('input[name=opsb]:checked'); if (!sel) return;
      const b = brs.find((x) => x.id === sel.value); btn.disabled = true;
      try {
        const r = await api.flights.opsHandover(state.flight.id, sel.value);
        const no = r.no || (b ? b.no || b.id : r.briefingId || sel.value);
        state.meta.opsHandover = { briefingId: r.briefingId || sel.value, no, url: r.url || '', at: Date.now(), points: r.points || 0 }; saveMeta();
        close(); toast(t(r.created ? 'rep.opsSentNew' : 'rep.opsSent', { no, n: r.points || 0 })); if (onDone) onDone();
      } catch (e) { btn.disabled = false; toast(t('rep.opsFailed', { err: e.message || '' }), true); }
    },
  });
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.body.appendChild(bg);
}
