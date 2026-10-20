// One-line description of how several devices were merged (Bereinigen protocol, report). Pure.
import { t } from '../i18n.js';
import { fmtDurationHM } from '../util/format.js';

export function mergeLine(track) {
  const info = track && track.merge;
  if (!info || info.devices.length < 2 || !info.multiSec) return '';
  const names = info.devices.map((d) => d.name).join(', ');
  const primary = (info.devices.find((d) => d.key === info.primary) || {}).name || '';
  return info.mode === 'primary'
    ? t('cln.mergePrimary', { n: info.devices.length, names, primary, filled: fmtDurationHM(info.filledSec) })
    : t('cln.mergeConsensus', { n: info.devices.length, names, dur: fmtDurationHM(info.multiSec), step: Math.round((info.gridPoints && info.multiSec) ? info.multiSec / Math.max(1, info.gridPoints - 1) : 10), rejected: info.rejected });
}
