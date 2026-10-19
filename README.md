# analyze – analyze.wicki.aero

Fahrtanalyse aus Trackerdaten für Ballonfahrten (Wicki Partners Ballonteam).
Fünf Phasen: **Importieren · Bereinigen · Auswerten · Bericht · Exportieren**.
Alles läuft im Browser (Chrome, Edge, Firefox, Safari); es werden keine Daten hochgeladen.
Konzept: `docs/Konzept_analyze_v0.1.md` · Design-Boards: `design/` (Claude Design, Stand Phase 0).

**Stand: Version 0.7.0 = Phase 1 und 2 komplett, Phase 3 begonnen:** Kennung (6 Buchstaben), eigenes Logo,
Fahrtarchiv «Meine Fahrten», Fahrt speichern mit Kurzlink `analyze.wicki.aero/v/‹ID›` und QR-Code, öffentlicher
Viewer, Supermaster, **Ereignislog** aus `bwicki/gb_flight_data` (Worker, Team-Freigabe) oder als JSON/CSV-Datei,
**Profil-Assistent** für unbekannte Trackerformate (Profile für alle Kennungen geteilt), **Fotos** auf dem Track
(EXIF-Zeit, Kamerazeitzone, Viewer/QR, Berichtsseite). Dafür läuft ein kleiner Cloudflare Worker (`worker/`, D1 + R2)
– Einrichtung in §6. Offen in Phase 3: Stammdaten-Übergabe aus ops.wicki.aero.

---

## 1. Was ist wo?

| Ordner / Datei | Inhalt |
|---|---|
| `index.html`, `css/`, `i18n/`, `img/`, `src/` | Die App (eine Seite). Sprachen in `i18n/de.json` und `en.json` |
| `src/parse/` | Trackerprofile (`profiles.js`), Leser für CSV/JSONL/GPX/KML/IGC (`readers.js`), ZIP ohne Fremdbibliothek (`zip.js`) |
| `src/process/` | Segmente und Zusammenfügen (`segments.js`), abgeleitete Reihen (`series.js`), Start-/Landeerkennung (`detect.js`), Kennzahlen (`stats.js`), Track für Anzeige/Export (`track.js`) |
| `src/export/` | GPX, GeoJSON, KML/KMZ, CSV (`formats.js`), Downloads (`download.js`) |
| `src/ui/` | Die fünf Phasen, Karte (Leaflet), Höhenprofil (SVG) |
| `src/worker/parse-worker.js` | Parser im Web Worker (80-MB-Logs ohne Einfrieren der Seite) |
| `src/api.js`, `src/session.js`, `src/flightio.js` | Worker-Client, Kennung im Browser, Speichern/Öffnen von Fahrten (GeoJSON) |
| `src/ui/start.js`, `flights.js`, `admin.js` | Startseite (Kennung), Meine Fahrten, Supermaster |
| `src/util/qr.js` | QR-Code-Erzeuger (eigener Code, kein Fremdcode) für Kurzlinks |
| `src/events/log.js`, `src/ui/events.js` | Ereignislog: Normalisierung der Reporting-App-Zeilen, Verknüpfung mit dem Track, Karte/Profil/Tabelle |
| `src/parse/assist.js`, `src/ui/assist.js`, `src/profiles-store.js` | Profil-Assistent: Dateianalyse, Spaltenvorschläge, Profil-JSON, Vorschau; geteilte und lokale Profile |
| `src/photos/{exif,place,process,store}.js`, `src/ui/photos.js` | Fotos: EXIF-Leser (Zeit, Zone, GPS), Verkleinern im Browser, Platzierung auf dem Track, Kamerazeit-Vorschlag |
| `worker/` | Cloudflare Worker: `wrangler.toml`, `schema.sql` (D1), `src/` (API) |
| `404.html` | Leitet Kurzlinks `/v/‹ID›` auf die App um (GitHub Pages) |
| `tests/` | Automatische Tests (`node --test`), inkl. verdünnter GB26-Daten als Fixture und Worker-API mit Attrappen |
| `docs/` | Konzept |
| `design/` | Freigegebene Design-Boards (Phase 0) |
| `CNAME` | Domain für GitHub Pages (`analyze.wicki.aero`) |

Externer Code: nur Leaflet 1.9.4 (Karte) von cdnjs und die IBM-Plex-Schriften von Google Fonts.
Kartenkacheln: OpenStreetMap, OpenTopoMap, Esri World Imagery. Ortsnamen (optional, abschaltbar): Nominatim/OSM.

---

## 2. Veröffentlichen (GitHub Pages) – einmalig

1. Im Repo **Settings → Pages**.
2. «Build and deployment»: **Source = Deploy from a branch**, Branch **`main`**, Ordner **`/ (root)`** → **Save**.
3. «Custom domain»: `analyze.wicki.aero` (kommt aus `CNAME`). Bei Cloudflare (DNS von `wicki.aero`) braucht es
   einen **CNAME-Eintrag** `analyze` → `bwicki.github.io` (Proxy-Status «DNS only», grau).
4. Warten, bis der «DNS check» grün ist, dann **Enforce HTTPS** anhaken.
5. Ab jetzt ist jede Änderung an `main` nach 1–2 Minuten unter **https://analyze.wicki.aero** live
   (Ersatzadresse: `https://bwicki.github.io/analyze/`).

Die App läuft auch ohne Worker (dann ohne Kennung und Speichern) – `apiBase` in `src/config.js` leer lassen.

---

## 3. Bedienung in Kürze

1. **Importieren** – Dateien oder ein ganzes ZIP (z. B. `gb26_data.zip`) ins Feld ziehen. Erkannt werden
   GB-Instrument CSV/JSONL, GPX, KML/KMZ, IGC, aprs.fi-CSV. Doppelte Aufzeichnungen (CSV + JSONL) werden einmal
   verwendet, Aufzeichnungen anderer Fahrten ausgeblendet.
2. **Bereinigen** – Zeitleiste mit Segmenten, Neustarts und Nacht; Start/Landung erkannt; Schnitt mit Griffen
   oder Zeiten; Protokoll der Aufbereitung.
3. **Auswerten** – Karte (Strasse/Topo/Satellit, Farbe nach Vario oder Höhe, Zeitmarker), Kennzahlen (ICAO oder
   metrisch), Höhenprofil mit Nacht und Fahrt über Grund; Maus über Profil ↔ Marker auf der Karte.
   «In Google Earth öffnen» sichert eine KMZ mit Zeitregler. Klick auf den Track (Karte) oder ins Profil hält den
   Zeitpunkt in beiden fest. Ortsnamen im Format `CH-Willisau`. Eine fälschlich erkannte **Zwischenlandung**
   (Richtungsumkehr, Stillstand) entfernt das × am Marker bzw. in der Kennzahlenliste/Bereinigen; die beiden
   Abschnitte werden zusammengefügt (wiederherstellbar). **Ereignislog:** «Aus gb_flight_data verknüpfen»
   (abgeschlossene Fahrten der Reporting-App, passende nach Zeitraum markiert; braucht Kennung mit Team-Freigabe und Worker-Token) oder
   «Datei (JSON/CSV)» (Export der Reporting-App). Ereignisse erscheinen als farbige Marker auf Karte und Profil,
   als Tabelle mit Δ (Abstand gemeldete Position ↔ Track), filterbar nach Typ; Maus über eine Zeile zeigt den Punkt.
   Beim Speichern der Fahrt wird das Log mitgespeichert (Viewer und «Öffnen» zeigen es). Ballast-Restbestand aus
   den Ballast-Einträgen erscheint als gestrichelte Linie im Höhenprofil (rechte Skala).
   **Fotos** (ab 0.7.0, braucht eine gespeicherte Fahrt): «Fotos hinzufügen» nimmt JPEGs von Kamera oder Handy, liest
   die Aufnahmezeit (EXIF) und legt jedes Bild auf den Track (Position, Höhe); Bilder werden im Browser auf 2000 px
   verkleinert (+ Vorschaubild) und unter der Kennung gespeichert. «Kamerazeit» = Zeitzone der Kamera-Uhr (Heimzeit,
   Sommerzeit UTC+02:00; EXIF-Zonen neuerer Handys werden direkt verwendet), «Feinkorrektur» für vor-/nachgehende
   Uhren, «Aus GPS-Fotos vorschlagen» bestimmt die Zone aus Fotos mit GPS-Position (Δ = Abstand zum Track).
   Bildtext je Foto, Maus über ein Foto → Ort auf Karte/Profil, Klick → Grossansicht. Der Viewer hinter dem
   Kurzlink/QR-Code zeigt die Fotos ebenfalls; der Bericht erhält eine Fotoseite (bis 24 Bilder).
4. **Bericht** – Stammdaten eintragen, «Drucken / PDF» (im Druckdialog «Als PDF sichern»). Gespeicherte Fahrten
   tragen Kurzlink und QR-Code in der Fusszeile.
5. **Exportieren** – GPX, GeoJSON, KMZ, CSV, alles als ZIP; Auflösung wählbar. **Fahrt speichern** legt den
   geschnittenen Track (volle Auflösung, komprimiert), Kennzahlen und Stammdaten unter der Kennung ab und erzeugt den
   Kurzlink `analyze.wicki.aero/v/‹ID›` (QR-Code daneben; «Kurzlink deaktivieren» macht die Fahrt privat).

**Kennung:** Startseite → «Neue Kennung erzeugen» (einmal notieren) oder vorhandene eingeben. Die Kennung ist das
einzige Geheimnis – wer sie kennt, sieht und ändert die Fahrten darunter. «Ohne Kennung ausprobieren» = Phase-1-Betrieb.
**Meine Fahrten** (Klick auf die Kennung oben rechts): Liste, Öffnen ohne Neu-Import, Löschen, Anzeigename, eigenes
Logo (PNG/JPEG/SVG/WebP ≤ 1 MB; sonst Ballonteam-Logo), Vorgaben (Standard-Ballon, PIC).
**Viewer:** Der Kurzlink zeigt Auswerten und Bericht ohne Kennung, ohne Bearbeiten.
**Supermaster** (☰ → Supermaster oder `#admin`): einmalig Name + PIN einrichten; sieht alle Kennungen (sperren,
löschen, **Team-Freigabe** für das Ereignislog aus gb_flight_data), alle Fahrten und das Nutzungsprotokoll.

Einstellungen (☰): Einheiten, Zeitmarker, Ortsnamen, Experte (Lücken, Erkennungsschwellen), Kennung wechseln.

---

## 4. Tests

```
node --test tests/*.test.js
```

Die Tests prüfen Leser, Zusammenfügen, Erkennung, Kennzahlen (GB26: Start 23:31 UTC, Landung 16:34 UTC,
41 h 03 min, ≈ 1 588 km, 1 Neustart, 2 Nächte), Exporte, den GeoJSON-Rundlauf (gespeicherte Fahrt öffnet mit
denselben Segmenten und Kennzahlen), die Worker-API (mit D1/R2-Attrappen) und die Vollständigkeit der Übersetzungen.
Der Workflow `.github/workflows/tests.yml` führt sie bei jedem Push aus.

---

## 5. Neues Trackerprofil

**Profil-Assistent (ab 0.6.0):** Wird eine Datei nicht erkannt, erscheint unter Importieren der Hinweis «Format
unbekannt» mit dem Knopf **Profil-Assistent öffnen**. Drei Schritte: (1) Datei lesen – Trennzeichen, Kopfzeile,
Dezimalzeichen werden erkannt und sind änderbar; (2) Spalten zuordnen – Vorschläge je Normfeld aus Spaltennamen und
Wertebereichen (Zeit als eine Spalte oder Datum + Zeit, Einheiten m/ft, kt/km/h/m/s, cm/s/ft/min, V/%), Vorschau
mit Zeitraum, Fix-Punkten, Höhen und Trackskizze; (3) Benennen und speichern – mit Kennung wird das Profil über den
Worker **für alle Kennungen** geteilt, ohne Kennung bleibt es im Browser. Danach wird das Format automatisch erkannt
(geteilte Profile werden beim Start geladen). Eigene Profile lassen sich unter «Erkannte Trackerprofile» entfernen,
der Supermaster sieht alle unter «Profile». Erkannt werden CSV/TSV, JSON Lines und JSON-Arrays; GPX/KML/IGC sind
fest eingebaut.

**Fest eingebaute Profile** stehen in `src/parse/profiles.js` (gleiches JSON-Format: Erkennung, Lesen, Felder mit
Einheit); die beiden GB-Instrument-Profile dienen als Vorlage.

---

## 6. Phase 2 einrichten: Worker, D1, R2 (nur Browser, keine lokalen Werkzeuge)

Gleiches Muster wie s2ground/ops: der Worker wird von GitHub Actions deployt, die Datenbank und der Speicher
werden einmalig im Cloudflare-Dashboard angelegt.

1. **D1-Datenbank anlegen:** Cloudflare-Dashboard → *Storage & Databases → D1 SQL Database → Create* → Name **`analyze`**
   (Standort «Western Europe» wählen, wenn angeboten). Auf der Datenbankseite die **Database ID** kopieren und in
   `worker/wrangler.toml` bei `database_id` eintragen (im Repo direkt auf GitHub editierbar: Datei öffnen → Stift).
2. **R2-Bucket anlegen:** *R2 Object Storage → Create bucket* → Name **`analyze`** (Location hint «Western Europe»).
   Beim ersten Mal muss R2 aktiviert werden (Zahlungsmittel hinterlegen; Free-Kontingent 10 GB reicht lange).
3. **API-Token erzeugen:** *My Profile → API Tokens → Create Token → «Edit Cloudflare Workers»-Vorlage*, zusätzlich
   die Berechtigungen **Account · D1 · Edit** und **Account · Workers R2 Storage · Edit** hinzufügen, auf das Konto
   einschränken → Token kopieren.
4. **GitHub-Secrets setzen:** Repo `bwicki/analyze` → *Settings → Secrets and variables → Actions → New repository
   secret*: `CLOUDFLARE_API_TOKEN` (Token aus Schritt 3) und `CLOUDFLARE_ACCOUNT_ID` (Dashboard → Workers & Pages →
   rechts «Account ID»).
5. **Deployen mit Schema:** *Actions → «Deploy worker» → Run workflow* → Haken bei **migrate** → Run. Der Lauf legt
   die Tabellen an (`worker/schema.sql`) und deployt den Worker `analyze-api`. Danach genügt jeder Push unter `worker/`;
   `migrate` nur wieder anhaken, wenn sich `schema.sql` ändert (idempotent).
6. **Adresse eintragen:** *Workers & Pages → analyze-api* zeigt die Adresse `https://analyze-api.‹subdomain›.workers.dev`.
   Weicht sie von `apiBase` in `src/config.js` ab, dort anpassen (Pages deployt automatisch). Test:
   `https://analyze-api.‹subdomain›.workers.dev/api/health` → `{"ok":true,…}`.
7. **Supermaster einrichten:** `https://analyze.wicki.aero/#admin` → Name + PIN (einmalig; danach nur noch Login).
8. **Ereignislog freischalten (optional):** GitHub → *Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate*: Repository access nur `bwicki/gb_flight_data`, Permission **Contents: Read-only**,
   Ablauf z. B. 1 Jahr. Token als GitHub-Secret `GITHUB_DATA_TOKEN` im Repo `bwicki/analyze` hinterlegen und
   «Deploy worker» einmal laufen lassen – der Workflow legt es als Worker-Secret ab (`wrangler secret put`); der
   Token verlässt den Worker nie. Ohne Secret bleibt nur der Datei-Upload des Logs. Danach im Supermaster bei den
   Kennungen des Ballonteams «Team-Zugang geben» – nur diese sehen den Knopf «Aus gb_flight_data verknüpfen».

Secrets liegen ausschliesslich in GitHub Secrets; `wrangler.toml` enthält keine. Aufbewahrung: Fahrten werden
730 Tage nach der letzten Änderung vom täglichen Cron gelöscht (`RETENTION_DAYS`). Speicher pro Kennung: 300 MB
(`QUOTA_MB`), Track ≤ 25 MB komprimiert, Logo ≤ 1 MB. CORS: nur die Origins aus `APP_ORIGINS`.

**API (Worker):** `POST /api/codes` · `GET|PUT /api/me` · `PUT|DELETE /api/me/logo` · `GET /api/logo/‹code›` ·
`GET|POST /api/flights` · `GET|PUT|DELETE /api/flights/‹id›` · `GET /api/flights/‹id›/track|events` ·
`GET /api/view/‹id›[/track|/events]` (öffentlich) · `GET /api/events/flights`, `/api/events/‹Fahrt›`,
`/api/events/media/‹Datei›` (Ereignislog aus gb_flight_data, Team-Kennungen, 5 min Cache) · `GET /api/profiles`
(öffentlich), `POST /api/profiles`, `DELETE /api/profiles/‹id›` (eigene) · `GET|POST /api/flights/‹id›/photos`,
`PUT|DELETE /api/flights/‹id›/photos/‹pid›`, `GET /api/view/‹id›/photos`, `GET /api/photos/‹pid›[/thumb]` (Bild;
öffentlich bei öffentlicher Fahrt) · `/api/admin/…` (Supermaster, Bearer-Token). Kennung als Header `X-Code`.
Speichern = multipart `meta` (JSON) + `track` (gzip GeoJSON) + `events` (JSON); Foto = multipart `meta` + `image` + `thumb` (JPEG).
Tabellen, die nach der ersten Migration dazukamen (`codes.team`, `photos`), legt der Worker beim ersten Aufruf selbst an.

Lizenz: Alle Rechte vorbehalten – Nutzung nur mit ausdrücklicher Zustimmung und Quellenangabe (Wicki Partners Ballonteam).
