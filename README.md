# analyze – analyze.wicki.aero

Fahrtanalyse aus Trackerdaten für Ballonfahrten (Wicki Partners Ballonteam).
Fünf Phasen: **Importieren · Bereinigen · Auswerten · Bericht · Exportieren**.
Alles läuft im Browser (Chrome, Edge, Firefox, Safari); es werden keine Daten hochgeladen.
Konzept: `docs/Konzept_analyze_v0.1.md` · Design-Boards: `design/` (Claude Design, Stand Phase 0).

**Stand: Version 0.1.0 = Phase 1 (lokal, ohne Konto).** Kennung, Logo, Fahrtarchiv, Ereignislog aus
`gb_flight_data`, Profil-Assistent, Kurzlink/QR und die ops-Übergabe folgen in Phase 2 und 3 (Konzept §13).

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
| `tests/` | Automatische Tests (`node --test`), inkl. verdünnter GB26-Daten als Fixture |
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

Kein Worker, keine Secrets in Phase 1.

---

## 3. Bedienung in Kürze

1. **Importieren** – Dateien oder ein ganzes ZIP (z. B. `gb26_data.zip`) ins Feld ziehen. Erkannt werden
   GB-Instrument CSV/JSONL, GPX, KML/KMZ, IGC, aprs.fi-CSV. Doppelte Aufzeichnungen (CSV + JSONL) werden einmal
   verwendet, Aufzeichnungen anderer Fahrten ausgeblendet.
2. **Bereinigen** – Zeitleiste mit Segmenten, Neustarts und Nacht; Start/Landung erkannt; Schnitt mit Griffen
   oder Zeiten; Protokoll der Aufbereitung.
3. **Auswerten** – Karte (Strasse/Topo/Satellit, Farbe nach Vario oder Höhe, Zeitmarker), Kennzahlen (ICAO oder
   metrisch), Höhenprofil mit Nacht und Fahrt über Grund; Maus über Profil ↔ Marker auf der Karte.
   «In Google Earth öffnen» sichert eine KMZ mit Zeitregler.
4. **Bericht** – Stammdaten eintragen, «Drucken / PDF» (im Druckdialog «Als PDF sichern»).
5. **Exportieren** – GPX, GeoJSON, KMZ, CSV, alles als ZIP; Auflösung wählbar.

Einstellungen (☰): Einheiten, Zeitmarker, Ortsnamen, Experte (Lücken, Erkennungsschwellen).

---

## 4. Tests

```
node --test tests/*.test.js
```

Die Tests prüfen Leser, Zusammenfügen, Erkennung, Kennzahlen (GB26: Start 23:31 UTC, Landung 16:34 UTC,
41 h 03 min, ≈ 1 588 km, 1 Neustart, 2 Nächte), Exporte und die Vollständigkeit der Übersetzungen.
Der Workflow `.github/workflows/tests.yml` führt sie bei jedem Push aus.

---

## 5. Neues Trackerprofil (bis der Assistent kommt)

Ein Profil ist ein Eintrag in `src/parse/profiles.js`: Erkennung (Dateiendung, Kopfzeile), Lesen (Trennzeichen,
Kopfzeile) und Zuordnung der Spalten zu den Normfeldern (Zeit, Breite, Länge, GPS-Höhe, Druckhöhe, Druck, Vario,
Fahrt, Kurs, Runtime, Batterie) mit Einheit. Die beiden GB-Instrument-Profile dienen als Vorlage.

Lizenz: Alle Rechte vorbehalten – Nutzung nur mit ausdrücklicher Zustimmung und Quellenangabe (Wicki Partners Ballonteam).
