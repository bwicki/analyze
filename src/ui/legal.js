// «Legal Mambojumbo» (0.9.3): private application, no commercial use, no liability, data kept but never passed on.
// Text in German and English (follows the app language); opened from the ☰ menu and the footer.

import { html, onAct, icons } from '../util/dom.js';
import { t } from '../i18n.js';

const MAIL = 'balthasar@wicki.aero';

const DE = `
<h2>Private Anwendung</h2>
<p>analyze.wicki.aero ist eine private Anwendung von Balthasar Wicki (Wicki Aero GmbH) für Ballonfahrerinnen und Ballonfahrer. Die Nutzung ist kostenlos und ausschliesslich für den privaten, nicht kommerziellen Gebrauch erlaubt. Eine gewerbliche Nutzung, der Weiterverkauf oder das Einbinden in andere Dienste sind ohne schriftliche Zustimmung nicht gestattet. Der Quellcode ist einsehbar (Repository <code>bwicki/analyze</code>); die Lizenz dort gilt.</p>
<h2>Keine Haftung, keine Gewähr</h2>
<p>Die App ist eine Auswertungshilfe ohne Gewähr. Kennzahlen, Karten, Profile, Berichte und Exporte entstehen aus den Trackerdaten so, wie sie aufgezeichnet wurden; sie ersetzen weder das Logbuch noch die eigene Prüfung. Die Verantwortung für Aufzeichnungen, Einträge und deren Verwendung – insbesondere gegenüber Behörden, Versicherungen und Betreibern – bleibt bei der Pilotin oder dem Piloten. Wicki Aero GmbH und Balthasar Wicki schliessen jede Haftung für Schäden aus der Nutzung oder Nichtverfügbarkeit der App, aus fehlerhaften Daten oder Berechnungen und aus Datenverlust aus, soweit gesetzlich zulässig. Ein Anspruch auf Verfügbarkeit besteht nicht; der Dienst kann jederzeit geändert oder eingestellt werden – wichtige Fahrten bitte selbst exportieren (GPX, GeoJSON, KMZ, CSV, PDF).</p>
<h2>Daten</h2>
<p>Ohne persönlichen PIN läuft alles im Browser; nichts wird übertragen. Mit einem PIN werden gespeicherte Fahrten (Track, Kennzahlen, Stammdaten des Berichts, Rohdateien, Fotos, Logo, Einstellungen) auf Servern von Cloudflare abgelegt und dem PIN zugeordnet. Diese Daten werden Dritten nicht zur Verfügung gestellt, nicht verkauft und nicht ausgewertet; nur die Inhaberin oder der Inhaber des PIN und der Betreiber (zur Wartung) haben Zugriff. Wer einen Kurzlink oder QR-Code kennt, sieht die damit freigegebene Fahrt im Viewer – Links werden nur erzeugt, wenn Du eine Fahrt speicherst, und lassen sich jederzeit deaktivieren. Gespeicherte Fahrten können unter «Meine Fahrten» gelöscht werden; auf Wunsch löscht der Betreiber alle Daten eines PIN. Beim Laden von Kartenkacheln, Gelände- und Ortsdaten erreichen technische Angaben (IP-Adresse, Kachelkoordinaten) die jeweiligen Anbieter (OpenStreetMap, OpenTopoMap, Esri, Mapzen/AWS, open-meteo, OpenFreeMap, Nominatim, Photon). Die App setzt keine Cookies; Einstellungen und der PIN liegen im lokalen Speicher Deines Browsers.</p>
<h2>Recht und Kontakt</h2>
<p>Es gilt schweizerisches Recht. Fragen, Löschwünsche und unbekannte Trackerformate: <a href="mailto:${MAIL}">${MAIL}</a>.</p>`;

const EN = `
<h2>Private application</h2>
<p>analyze.wicki.aero is a private application by Balthasar Wicki (Wicki Aero GmbH) for balloon pilots. Use is free of charge and permitted for private, non-commercial purposes only. Commercial use, resale or embedding in other services require written consent. The source code is public (repository <code>bwicki/analyze</code>); its licence applies.</p>
<h2>No liability, no warranty</h2>
<p>The app is an analysis aid without warranty. Figures, maps, profiles, reports and exports are derived from the tracker data as recorded; they replace neither the logbook nor your own checks. Responsibility for records, entries and their use – in particular towards authorities, insurers and operators – stays with the pilot. Wicki Aero GmbH and Balthasar Wicki exclude any liability for damage arising from the use or unavailability of the app, from erroneous data or calculations and from data loss, to the extent permitted by law. There is no entitlement to availability; the service may be changed or discontinued at any time – export important flights yourself (GPX, GeoJSON, KMZ, CSV, PDF).</p>
<h2>Data</h2>
<p>Without a personal PIN everything runs in your browser; nothing is transmitted. With a PIN, saved flights (track, figures, report master data, raw files, photos, logo, settings) are stored on Cloudflare servers and tied to that PIN. These data are not made available to third parties, not sold and not analysed; only the PIN holder and the operator (for maintenance) have access. Anyone who knows a short link or QR code can see the flight released with it in the viewer – links are only created when you save a flight and can be deactivated at any time. Saved flights can be deleted under “My flights”; on request the operator deletes all data of a PIN. Loading map tiles, terrain and place data sends technical details (IP address, tile coordinates) to the respective providers (OpenStreetMap, OpenTopoMap, Esri, Mapzen/AWS, open-meteo, OpenFreeMap, Nominatim, Photon). The app sets no cookies; settings and the PIN live in your browser's local storage.</p>
<h2>Law and contact</h2>
<p>Swiss law applies. Questions, deletion requests and unknown tracker formats: <a href="mailto:${MAIL}">${MAIL}</a>.</p>`;

export function showLegal() {
  const lang = (document.documentElement.lang || 'de').startsWith('en') ? 'en' : 'de';
  const bg = html(`<div class="modal-bg"><section class="modal legal" role="dialog" aria-modal="true" aria-label="${t('legal.title')}">
    <div class="head" style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h1>${t('legal.title')}</h1><button type="button" class="vx" data-act="close" title="${t('vw.close')}" aria-label="${t('vw.close')}">${icons.close}</button></div>
    <div class="legal-body">${lang === 'en' ? EN : DE}</div>
    <div class="foot"><button class="btn primary" type="button" data-act="close">${t('wel.ok')}</button></div>
  </section></div>`);
  const close = () => bg.remove();
  onAct(bg, { close });
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  document.body.appendChild(bg);
  bg.querySelector('.btn.primary').focus();
}
