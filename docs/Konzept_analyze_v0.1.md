# Konzept analyze.wicki.aero – Fahrtanalyse aus Trackerdaten

Oct 17, 2026 · @Balthasar · Entwurf v0.1 zur Freigabe

## 1 Ziel und Abgrenzung

analyze.wicki.aero macht aus beliebigen Tracker-Aufzeichnungen einer Ballonfahrt in fünf Schritten eine geprüfte Fahrtanalyse: bereinigter Track, Karte, Höhenprofil, Kennzahlen, Fahrtbericht als PDF fürs Logbuch, dazu GPX/GeoJSON/KML.

- Eingabe: eine oder mehrere Rohdateien (auch als ZIP) aus beliebigen Trackern. Bekannte Formate werden automatisch erkannt; unbekannte beschreibt ein Assistent einmalig, das Ergebnis wird als Trackerprofil für alle Nutzer gespeichert.
- Nutzer: Pilotinnen und Piloten ohne technische Vorkenntnisse. Zugang über eine 6-stellige Buchstaben-Kennung, eigenes Logo möglich, Vorgabe ist das Logo Wicki Partners Ballonteam.
- Alles Rechnen passiert im Browser; der Server (Cloudflare Worker) hält nur Kennungen, Logos, Trackerprofile und gespeicherte Fahrten.
- Nicht Gegenstand: Live-Tracking und Fahrtdaten-Erfassung (bleiben bei ops.wicki.aero und reporting.wicki.aero), Wetter, Planungsvergleich (Debriefing-Teil von ops). analyze liefert diesen Apps aber den bereinigten Track.
- Hosting und Look & Feel wie s2ground.wicki.aero: GitHub Pages aus dem Repository bwicki/analyze (CNAME analyze.wicki.aero liegt bereits), Cloudflare Worker mit D1 und R2, IBM Plex, Phasen-Chips, DE/EN.

Die zehn UI-Boards zu diesem Konzept (Start, fünf Phasen, Profil-Assistent, Meine Fahrten, PDF-Seiten, Handy) liegen im Designer: [analyze.wicki.aero – UI-Boards](https://claude.ai/artifact/AFD2zgPX5FakZDv69gHXTy). Karte und Höhenprofil darin sind aus den echten GB26-Daten gerechnet.

## 2 Befund aus den Beispieldaten (gb26\_data.zip)

Die 42-h-Fahrt GB26 (HB-QWV, Gladbeck → Finnland) liegt in zwei Logs mit einem Tracker-Neustart um 02:41 UTC am 30.08.2026; das ZIP enthält daneben 20 weitere Logs (Bodenläufe in Rümlang, Tests, frühere Fahrten), jedes doppelt als CSV und JSONL.

| Datei | Zeitraum (UTC) | Punkte | Inhalt |
| --- | --- | --- | --- |
| log\_000000\_1949 | 28.08. 19:50 – 20:49 | 3 297 | Tracker am Boden in Gladbeck, Datum beim Anlegen noch unbekannt (Dateiname 000000) |
| log\_260828\_2049 | 28.08. 20:49 – 30.08. 02:41 | 100 195 | Start und 27 h Fahrt bis Ösel (Saaremaa) |
| log\_260830\_0242 | 30.08. 02:42 – 17:18 | 49 038 | Nach Neustart (Lücke 25 s) bis Landung und 44 min am Boden |

Kennzahlen, die die App aus diesen drei Dateien automatisch ableiten muss (mit meinem Prüfskript berechnet):

| Kennzahl | Wert |
| --- | --- |
| Start | 28.08.2026 23:31 UTC, 51.5574 N 6.9740 E (Gladbeck) |
| Landung | 30.08.2026 16:34 UTC, 60.4643 N 26.3927 E (bei Loviisa, FI) |
| Fahrtdauer | 41 h 03 min, eine Landung |
| Strecke | 1 589 km Track, 1 551 km Luftlinie |
| Höhe max. | 947 m GPS, 962 m Druckhöhe (QNE) |
| Fahrt über Grund max. | 37 kt |
| Steigen/Sinken (robust, 0.1–99.9 %) | +3.0 / −2.2 m/s; Rohwerte bis +27 m/s beim Neustart sind Sensorartefakte |
| Beschleunigung (Spalte Master) | −2.9 … +2.5 m/s² |
| Abtastung | 1 Hz (92 %), sonst 2–5 s; 935 Doppelzeitstempel |

Format-Eigenheiten dieses Trackers, die das Trackerprofil abbilden muss:

- CSV mit Semikolon, 40 Spalten, Zeilenende nur CR (kein LF) – gängige Parser lesen die Datei als eine einzige Zeile.
- Datum dd/mm/yy und Zeit hh:mm:ss in UTC; Lat/Lon = 0 bedeutet kein GPS-Fix (nicht «Nullinsel»).
- QNH fest 1013.25 hPa, Baro\_Alt ist also Druckhöhe; SensorTemp konstant 15 °C und Startflag immer 0 (keine Messwerte); Envelope Temp, Burn- und Target-Spalten stammen aus dem Heissluft-Einsatz und bleiben leer.
- Zwei Vario-Spalten: VAR (roh, stark verrauscht) und VAR\_Kal (Kalman-gefiltert, brauchbar). Von den Beschleunigungsspalten trägt nur Master Werte (Slav1–3, sigACC, meanACC durchgehend 0), und Master ist ein Filterzustand, kein Messwert: Median 0.01 m/s², Ausschläge bis 2.9 m/s² nur in den 15 s nach dem Neustart, beim Aufsetzen 0.1 m/s²; die GPS-Höhe springt vereinzelt um über 200 m innerhalb von 10 s (30.08. 16:15 UTC) – ein Ausreisserfilter vor den Maxima ist nötig.
- Vereinzelte GPS-Datumsfehler (z. B. 10.02.2026 mitten im April-Log) – die App braucht einen Plausibilitätsfilter für Zeitstempel.
- JSONL: gleiche Felder mit Unterstrich-Namen (Baro\_Alt\_m, VAR\_Kal\_m\_s), CRLF, höhere Nachkommastellen; die JSONL-Datei ist 3× so gross wie die CSV (80 MB für 30 h). Bei doppelt vorhandenen Logs nimmt die App die JSONL-Fassung und meldet die CSV als Duplikat.

## 3 Ablauf in der App: fünf Phasen

Die App führt wie s2ground mit Phasen-Chips im Kopf von links nach rechts; jede Phase ist jederzeit wieder anwählbar, «Weiter» sitzt rechts in der Aktionsleiste. Dazu kommt die Seite «Meine Fahrten» hinter der Kennung.

1. Importieren – Dateien oder ZIP per Drag & Drop. Die App erkennt das Trackerprofil, liest alle Dateien im Browser (Web Worker, Streaming, auch 80-MB-JSONL) und zeigt je Datei Zeitraum, Punkte, GPS-Anteil. Unbekannte Dateien öffnen den Profil-Assistenten (Abschnitt 5).
2. Bereinigen – Segmente auf einer Zeitleiste; Neustarts und Lücken sind markiert. Vorschlag für Start und Landung aus der automatischen Erkennung; zwei Griffe schneiden Boden-Punkte vor dem Start und nach der Landung ab; Knöpfe «Vorschlag übernehmen» und «Segment ausschliessen».
3. Auswerten – Karte, Höhenprofil und Kennzahlentabelle nebeneinander, gekoppelt: ein Punkt im Profil leuchtet auf der Karte und umgekehrt. Hier wird auch das Ereignislog aus gb\_flight\_data geladen und auf Track und Profil gelegt (Abschnitt 9).
4. Bericht – Stammdaten eingeben (Pilot/PIC, Crew, Pax, Ballon, Veranstaltung, Bemerkungen), Vorschau des Fahrtberichts, PDF erzeugen.
5. Exportieren und teilen – GPX, GeoJSON, KML/KMZ für Google Earth, normierte CSV; Fahrt unter der Kennung speichern; Kurzlink und QR-Code zum Viewer.

Meine Fahrten – Liste aller unter der Kennung gespeicherten Fahrten mit Datum, Start, Landung, Dauer, Status des Berichts; Öffnen, Duplizieren, Löschen.

## 4 Nutzer, Kennung und Logo

Jeder Nutzer erhält auf Knopfdruck eine eindeutige Kennung aus sechs Grossbuchstaben (ohne I und O, z. B. KQZMWB); der Server prüft die Eindeutigkeit, die Kennung ist der einzige Schlüssel zu den eigenen Fahrten.

- Startseite: «Kennung eingeben» oder «Neue Kennung erzeugen». Die Kennung wird im Browser gemerkt; ohne Kennung läuft die App trotzdem (Phase 1–3 und Exporte), nur Speichern, Bericht-Archiv und Kurzlinks brauchen sie.
- Kein PIN für normale Kennungen (Entscheid 18.10.2026): Wer die Kennung kennt, kann lesen, speichern und löschen. Die App warnt deshalb beim Erzeugen, die Kennung nicht weiterzugeben.
- Profil hinter der Kennung: Anzeigename, Logo (PNG/SVG, max. 1 MB, wird auf 600 px Breite verkleinert und in R2 abgelegt), Standard-Ballon, Sprache, Einheiten (Vorgabe: ICAO – ft für Höhen, kt, m/s für Vario; umschaltbar auf m).
- Logo-Regel: Nutzerlogo im App-Kopf und auf dem Fahrtbericht; fehlt es, erscheint das Logo Wicki Partners Ballonteam (liegt in s2ground unter docs/wicki-ballonteam-logo.png vor).
- Supermaster (Anmeldename bwicki, zusätzlich PIN): sieht alle Kennungen, Fahrten und Trackerprofile, kann Profile freigeben oder korrigieren und Kennungen sperren.

## 5 Trackerprofile

Ein Trackerprofil ist eine kleine JSON-Beschreibung, wie aus einer Rohdatei die zehn Normfelder der App werden: Zeit (UTC), Breite, Länge, GPS-Höhe, Druckhöhe, Druck, Vario, Fahrt über Grund, Kurs, Beschleunigung; dazu optionale Felder (Batterie, Temperatur, Satelliten).

| Teil des Profils | Inhalt |
| --- | --- |
| Erkennung | Dateiendung, Kopfzeilen-Signatur (z. B. beginnt mit «Runtime;VbusVolt»), erste Zeichen bei JSON/JSONL, GPX/KML/IGC an der Struktur |
| Lesen | Trennzeichen, Zeilenende (LF, CRLF, nur CR), Kopfzeile ja/nein, Dezimalzeichen, Kodierung |
| Zuordnung | je Normfeld: Spaltenname oder JSON-Schlüssel, Einheit, Formel (z. B. ft → m), Datums-/Zeitformat, Zeitzone |
| Gültigkeit | Regeln wie «Lat = 0 und Lon = 0 → kein Fix», Wertebereiche, Jahr ≥ 2015 |
| Metadaten | Trackername, Hersteller, Firmware, Version des Profils, Autor (Kennung), öffentlich/privat |

Mitgelieferte Profile (Phase 1):

- Profil A «GB-Instrument CSV» und Profil B «GB-Instrument JSONL» für die Dateien aus dem ZIP (vorläufiger Name, Entscheid 18.10.2026).
- GPX 1.1, KML/KMZ (Google Earth, Garmin inReach), IGC (FAI-Logger, Gordon-Bennett-Pflichtformat), aprs.fi-CSV-Export, Garmin inReach CSV. Diese vier Standardformate deckt die App ohne Assistent ab.

Assistent für unbekannte Dateien (Phase 2): Die App analysiert die Datei (Trennzeichen, Zeilenenden, Kopfzeile, 200 Beispielzeilen), schlägt je Normfeld die wahrscheinlichste Spalte vor (nach Spaltenname und Wertebereich: Breite 35–70, Länge −10–40, Zeit als Datum erkennbar) und zeigt eine Vorschau als Karte und Profil. Der Nutzer bestätigt oder korrigiert die Zuordnung, gibt Trackername und Hersteller an und speichert; das Profil steht sofort allen zur Verfügung, der Supermaster kann es später bereinigen. Ohne Pflichtfelder (Zeit, Breite, Länge) gibt es kein Speichern.

## 6 Datenaufbereitung

Aus allen eingelesenen Dateien entsteht ein einziger Track in sechs Schritten; jeder Schritt protokolliert, was er geändert hat, und der Bericht druckt dieses Protokoll ab (Nachvollziehbarkeit fürs Logbuch).

1. Zeitstempel prüfen: Jahr ≥ 2015, monoton innerhalb einer Datei; Ausreisser wie der Sprung auf den 10.02.2026 werden verworfen und gezählt.
2. Segmente bilden: eine Datei = ein Segment; ein Runtime-Rücksprung innerhalb einer Datei teilt sie. Segmente werden nach Zeit sortiert, Überlappungen (z. B. CSV und JSONL derselben Aufzeichnung) als Duplikat erkannt und nur einmal verwendet.
3. Zusammenfügen: Segmente hintereinander, Lücken über 30 s bleiben als Lücke erhalten (gestrichelt auf Karte und Profil); Punkte ohne GPS-Fix werden für Karte und Strecke übersprungen, für das Druckhöhenprofil aber behalten.
4. Start und Landung erkennen: ein Punkt gilt als «in Fahrt», wenn im folgenden 120-s-Fenster die mittlere Fahrt über Grund über 2.5 kt oder das mittlere Vario über 0.4 m/s liegt; «am Boden», wenn beides unter 1 kt bzw. 0.25 m/s fällt. Jeder Wechsel Boden → Fahrt ist ein Start, Fahrt → Boden eine Landung; mehrere Landungen (Zwischenlandungen) werden gezählt. Am GB26-Datensatz liefert die Regel 23:31 UTC und 16:34 UTC.
5. Trimmen: Vorschlag = 2 min vor dem ersten Start bis 2 min nach der letzten Landung. Der Nutzer verschiebt die Griffe auf der Zeitleiste oder tippt Zeiten ein; «Automatisch» stellt den Vorschlag wieder her.
6. Glätten für Kennzahlen: Vario und Beschleunigung werden für Maxima über 30 s gemittelt, nachdem GPS-Sprünge (Höhenänderung über 20 m/s) verworfen sind (Rohwert bleibt im Export); Höhe aus GPS, bei fehlendem Fix aus der Druckhöhe mit dem letzten bekannten Versatz.

Die Vorgaben (Fenster, Schwellen, Lückenlänge, Trimm-Reserve) stehen im Expertenmenü und werden im Bericht mitgedruckt.

## 7 Kennzahlen der Fahrt

Die Kennzahlentabelle entsteht ohne Zutun aus dem bereinigten Track; jede Zeile nennt die Quelle (GPS, Baro, Sensor, berechnet), damit der Bericht prüfbar bleibt.

| Kennzahl | Berechnung | Quelle |
| --- | --- | --- |
| Startort, Startzeit | erster Start-Wechsel; Ort per Reverse-Geocoding (Nominatim/OSM über den Worker, 24 h Cache) plus Koordinaten im ICAO-Kurzformat | GPS |
| Landeort, Landezeit | letzter Landungs-Wechsel, gleich aufbereitet | GPS |
| Anzahl Landungen | Wechsel Fahrt → Boden, Zwischenlandungen einzeln gelistet mit Ort und Dauer am Boden | berechnet |
| Fahrtdauer | Landung minus Start, bei Zwischenlandungen Gesamt und reine Fahrtzeit | berechnet |
| Strecke, Luftlinie, Kurs | Haversine entlang des Tracks; Luftlinie Start–Landung mit rechtweisendem Kurs | GPS |
| Höhe max., mittlere Höhe | GPS-Höhe und Druckhöhe getrennt (ft und m) | GPS, Baro |
| Steigen/Sinken max. | grösster 30-s-Mittelwert nach Ausreisserfilter; Zeitpunkt und Höhe dazu | Vario oder aus Höhe |
| Fahrt über Grund max. und mittel | aus GPS, 10-s-Mittel | GPS |
| Beschleunigung max., g-Wert | Vertikalbeschleunigung = Änderung des Varios über 3 s, Horizontalbeschleunigung = Änderung der Fahrt über Grund über 3 s, dazu Aufsetzgeschwindigkeit (Vario beim Landen, GB26: −1.7 m/s); g-Wert = a / 9.81 nur bei Trackern mit Beschleunigungssensor (Profilfeld), beim GB-Instrument wird Master ignoriert | berechnet |
| Nachtfahrt | Summe der Zeit zwischen Ende und Beginn der bürgerlichen Dämmerung, berechnet am jeweiligen Ort des Ballons; Sonnenuntergang/-aufgang und Dämmerungszeiten werden mitgedruckt (Entscheid: bürgerliche Dämmerung) | berechnet |
| Lücken, Segmente | Anzahl Dateien, Neustarts, Lückenlänge, verworfene Punkte | Protokoll |
| Tracker-Extras | nur wenn vorhanden: Batterie min., Temperatur min./max., Satelliten | Sensor |

Bei NVFR-Fahrten weist die Tabelle die Nachtdauer zusätzlich pro Nacht aus (GB26: zwei Nächte). Einheiten folgen der Einstellung im Profil, Vorgabe ICAO (ft, kt, m/s).

## 8 Darstellungen

Karte und Höhenprofil sind gekoppelt (gleicher Zeiger, gleiche Zeitmarker, gleiche Ereignisse) und beide erscheinen im PDF als Bild.

- Karte (Leaflet wie in s2ground/ops): Kartenebenen OSM, OpenTopoMap, Satellit; Track als Linie, eingefärbt wahlweise nach Höhe oder nach Vario; Zeitmarker als Punkte mit Uhrzeit alle 60 min (umschaltbar 15/30/60/180 min); Marker für Start, Zwischenlandungen, Landung; Lücken gestrichelt; Nachtabschnitte dunkler. Knöpfe: «In Google Earth öffnen» (lädt eine KMZ mit Zeitstempeln, Google Earth öffnet sie per Doppelklick und zeigt den Zeitregler; einen Link, der Google Earth direkt mit fremden Daten öffnet, gibt es nicht), «Start in Google Maps», «Landung in Google Maps».
- Höhenprofil: Höhe über Zeit (UTC, Lokalzeit darunter), alternativ über Distanz; Linie in Vario-Farben (Sinken rot → neutral grau → Steigen blau, Skala ±3 m/s, in der Legende); Nachtphasen als graues Band; Zeitmarker wie auf der Karte; Ereignisse aus dem Log als Symbole; Hover zeigt Zeit, Höhe, Vario, Fahrt. Darunter zwei schmale Spuren: Fahrt über Grund und, wenn vorhanden, Beschleunigung.
- Zeitleiste in Phase 2: Segmente als Balken, Neustarts als Striche, Boden/Fahrt als Farbe, Griffe für Trimmen.
- Druckausgabe: Karte und Profil werden im Browser als PNG gerendert (Leaflet-Canvas, Profil als SVG) und in den Bericht gesetzt; A4 hoch, Karte über ganze Breite.

## 9 Verknüpfung mit dem Ereignislog (gb\_flight\_data)

Das Ereignislog aus reporting.wicki.aero (Repository bwicki/gb\_flight\_data, je Fahrt GB26.json/GB26.csv mit Zeilen vom Typ ATC, Ballast, Ressources, Note) wird über die Zeit auf den Track gelegt; jede Zeile bekommt so Höhe, Vario und Fahrt des Trackers zum Zeitpunkt der Meldung.

- Laden: Knopf «Ereignislog laden» in Phase 3 mit zwei Wegen – Datei hochladen (JSON oder CSV) oder «aus Repository»: der Worker holt data/\_flights.json und die gewählte Fahrt mit einem GitHub-Token (das Repository ist privat; Entscheid 18.10.2026: Worker mit Token). Die App schlägt die Fahrt vor, deren Zeitraum den Track überdeckt.
- Darstellung: Symbol je Typ auf Karte und Profil (ATC Funk, Ballast Sack, Ressources Batterie, Note Stift); Klick öffnet die Meldung; Tabelle «Ereignisse» mit Zeit UTC/lokal, Typ, Kurztext, Tracker-Höhe und Abweichung zur gemeldeten Höhe (alt\_ft) – das deckt Tippfehler in den Meldungen auf.
- Bericht: Ereignistabelle als eigener Abschnitt; Ballast-Verlauf (total\_ballast\_kg) als zweite Kurve im Höhenprofil, wenn gewünscht.
- Später: ops.wicki.aero (Teil Fahrtdaten) übergibt den bereinigten Track zurück – analyze exportiert dafür das normierte GeoJSON (Abschnitt 11).

## 10 Fahrtbericht (PDF) und Stammdaten

Der Fahrtbericht ist ein A4-Dokument mit Logo des Nutzers, das als Logbuch-Beleg archiviert wird; er entsteht im Browser über eine Drucklayout-Seite («Als PDF sichern»), ohne PDF-Bibliothek, und wird auf Wunsch unter der Kennung abgelegt.

| Seite | Inhalt |
| --- | --- |
| 1 | Kopf mit Logo, Titel (Fahrt-Nr., Datum, Ballon), Stammdaten-Block, Kennzahlentabelle, Unterschriftenzeile PIC |
| 2 | Karte mit Zeitmarkern und Ereignissen, darunter Höhenprofil mit Nachtphasen |
| 3 | Ereignistabelle (wenn Log verknüpft), Zwischenlandungen, Segmente und Aufbereitungsprotokoll |
| 4 (optional) | Fotos mit Zeit und Position (Folgephase) |

Stammdaten (Formular in Phase 4, Vorschläge aus dem Profil, pro Fahrt änderbar): Fahrt-Nr./Veranstaltung, Ballon (Kennzeichen, Typ, Volumen, Gas), PIC, Co-Pilot, Passagiere (Namen, nicht anonymisiert wie in ops), Startplatz-Name, Zweck (privat/gewerblich LTF, Wettkampf, Schulung), NVFR ja/nein, Bemerkungen. Alle Felder optional ausser Ballon und PIC.

Übergabe aus ops.wicki.aero (Folgephase): ops erzeugt für ein finalisiertes Briefing einen Link analyze.wicki.aero/?ops=‹Briefing-ID›; analyze holt Ballon, Crew, Pax, Startplatz und Fahrt-Nr. über die ops-API und füllt das Formular vor. Schnittstelle: ein JSON mit genau diesen Feldern, das ops liefert – festzulegen im ops-Konzept Fahrtdaten/Debriefing.

## 11 Exporte

Alle Exporte entstehen im Browser aus dem bereinigten Track und werden als Datei gespeichert; vor dem Export wählt der Nutzer die Auflösung (jeder Punkt, 10 s, 60 s) und sieht die Dateigrösse (GB26 bei 1 Hz: GPX rund 25 MB, bei 10 s 2.5 MB).

| Format | Inhalt | Wofür |
| --- | --- | --- |
| GPX 1.1 | ein Track mit Segmenten je Lücke; trkpt mit ele (GPS-Höhe), time; Erweiterungen für Vario, Fahrt, Druckhöhe; wpt für Start, Landungen, Ereignisse | Garmin, QGIS, Logbuch-Programme |
| GeoJSON | FeatureCollection: LineString mit \[lon, lat, alt\] und times-Feld, Punkte für Start/Landung/Ereignisse, Kennzahlen und Stammdaten als properties der Collection | ops.wicki.aero, Webkarten, Archiv |
| KML/KMZ | gx:Track mit Zeitstempeln, altitudeMode absolute, extrudiert, Stil nach Höhe; Ordner Marker und Ereignisse | Google Earth (Zeitregler) |
| CSV normiert | eine Zeile je Punkt mit den zehn Normfeldern in SI-Einheiten | Excel, eigene Auswertungen |
| Fahrtbericht PDF | Abschnitt 10 | Logbuch |

Das GeoJSON ist zugleich das interne Speicherformat (komprimiert in R2), damit eine gespeicherte Fahrt ohne Neu-Import wieder geöffnet werden kann.

## 12 Architektur, Hosting und Datenmodell

Gleiches Muster wie s2ground und ops: statische App auf GitHub Pages aus bwicki/analyze, ein Cloudflare Worker analyze-api mit D1 (Tabellen) und R2 (Dateien), veröffentlicht über GitHub Actions – kein Entwicklerwerkzeug auf dem Rechner nötig.

_(Architekturdiagramm: siehe Claude-Dokument – Browser-App, Worker analyze-api, D1/R2, gb_flight_data, Nominatim, GitHub Pages, ops.wicki.aero)_

Die App liest und rechnet vollständig im Browser; nur was Nutzer wiederfinden sollen (Kennung, Logo, Profile, gespeicherte Fahrten) geht an den Worker. GitHub Pages liefert die App, ops.wicki.aero liefert später Stammdaten.

| Tabelle / Ablage | Felder (Kern) |
| --- | --- |
| users (D1) | code (6 Buchstaben), pin\_hash (optional), display\_name, logo\_key, lang, units, created\_at, last\_seen, blocked |
| tracker\_profiles (D1) | id, name, manufacturer, version, spec\_json, created\_by, public, created\_at |
| flights (D1) | id (Kurz-ID 8 Zeichen), user\_code, title, start\_ts, end\_ts, stats\_json, meta\_json (Stammdaten), track\_key (R2), events\_key (R2), pdf\_key (R2), view\_token, created\_at, updated\_at |
| photos (D1, Folgephase) | flight\_id, r2\_key, taken\_at, lat, lon, caption |
| usage\_log (D1) | ts, user\_code, action, ip-Kürzel – nur Supermaster |
| R2 | tracks/‹id›.geojson.gz, logos/‹code›.png, reports/‹id›.pdf, photos/‹id›/… |

Technik im Browser: Vanilla JS als ES-Module (wie s2ground), Leaflet 1.9 für Karten, Profil als eigenes SVG (kein Chart-Framework), fflate für ZIP und gzip, exifr für Foto-Zeitstempel (Folgephase), qrcodejs für QR-Codes; Parser laufen in einem Web Worker, Dateien werden in Blöcken gelesen. Aufbewahrung gespeicherter Fahrten 2 Jahre wie bei ops (Entscheid 18.10.2026).

## 13 Phasenplan

Drei Lieferphasen mit je einer Abnahme; Phase 1 läuft ohne Server und ist mit dem GB26-Datensatz prüfbar, bevor Konto und Speicherung dazukommen.

| Phase | Version | Inhalt | Abnahmekriterium |
| --- | --- | --- | --- |
| 0 Konzept und Design | – | dieses Dokument, UI-Boards im Designer | Freigabe durch Balthasar, Antworten auf die Fragen in Abschnitt 15 |
| 1 Analyse lokal | 0.1–0.3 | Import (Profile A/B, GPX, KML, IGC, aprs.fi), Zusammenfügen, Start-/Landeerkennung, Trimmen, Karte, Höhenprofil, Kennzahlen, Exporte GPX/GeoJSON/KML/CSV, DE/EN, Handy-tauglich | GB26-ZIP ergibt ohne Handarbeit Start 23:31 UTC, Landung 16:34 UTC, 41 h 03 min, 1 589 km; Exporte öffnen in Google Earth und QGIS |
| 2 Konto, Bericht, Profile | 0.4–0.6 | Worker/D1/R2, Kennung und Logo, Meine Fahrten, Fahrtbericht PDF, Ereignislog aus gb\_flight\_data, Profil-Assistent mit geteilten Profilen, Supermaster, Kurzlink und QR | Bericht GB26 als PDF mit Logo und Ereignistabelle; unbekanntes Testformat wird per Assistent angelegt und von einer zweiten Kennung erkannt |
| 3 Übergabe und Fotos | 0.7–0.8 | Stammdaten aus ops.wicki.aero, Fotoordner verknüpfen (EXIF-Zeit auf Track, Kamera-Zeitversatz einstellbar), Viewer-Seite mit Karte, Profil und Fotos hinter Kurzlink/QR | Fotos einer Fahrt liegen auf dem Track und sind über den QR-Code vom Handy abrufbar |

Stand 18.10.2026: Phase 1 als 0.1.0 live; Phase 2 begonnen mit 0.4.0 (Worker/D1/R2, Kennung, Logo, Meine Fahrten, Fahrt speichern, Kurzlink und QR, Viewer, Supermaster). 0.5.0: Ereignislog aus gb_flight_data (Worker mit GitHub-Token, Team-Freigabe) und als Datei, auf Karte, Profil, Tabelle und Bericht. 0.6.0 (19.10.2026): Profil-Assistent mit geteilten Profilen – Phase 2 abgeschlossen. 0.7.0 (19.10.2026): Fotos auf dem Track (EXIF-Zeit, Kamerazeitzone, Viewer/QR, Berichtsseite) – Phase 3 begonnen; offen: ops-Übergabe. 0.7.1–0.7.5 (19./20.10.2026): Zeit von Hand für Fotos, Feedback-Runden (Layer-Radios, NVFR-Saum, WGS84, Berichtsfelder, Detailkarten, Landungs-Dialog, ZIP, «Persönlicher PIN»). 0.8.0 (20.10.2026): mehrere Geräte (Konsens/Hauptgerät), Rückfrage bei Fremddaten, Geländeprofil mit Wasserflächen, 3D-Karte (MapLibre). 0.8.1–0.8.3 (20.10.2026): Feedback-Runden (Wasseroberfläche/Gewässerboden, exaktes Einpassen, Berichtskopf mit QR, Link-Vorschau für Messenger, Schnitt in der Fahrt = Start/Landung, Höhenprofil in der Zeitleiste). 0.8.4 (20.10.2026): Vorschaubild der Fahrt für Messenger, Token-Status im Supermaster. 0.8.5 (20.10.2026): Schritt 5 «Speichern/Drucken/Exportieren» mit Druck und Speicher-Hinweis. 0.8.6 (20.10.2026): Schritt 5 nummeriert mit Auswahl-Download, Team-/Organisationsname je PIN, Rohdaten für den Supermaster, ops-Übergabe nur für Ballonteam/Supermaster, README neu, LICENSE. 0.8.7 (20.10.2026): Rohdateien mit der Fahrt gespeichert (Supermaster lädt sie als ZIP), Vorschaubild exakt eingepasst, Spezialfunktionen Balthasar im Bericht (Ereignislog-JSON wählen, ops-Übergabe), Einführungsfenster beim ersten Besuch. 0.8.8 (20.10.2026): PIN-Inhaber holen ihre Rohdaten unter «Meine Fahrten» zurück. 0.8.9 (20.10.2026): Akzentfarbe des Berichts je PIN. 0.9.0 (20.10.2026): Extremwerte als Symbole auf Karte/3D/Profil mit Knöpfen in den Kennzahlen, Auswerten öffnet in 3D mit 10× Überhöhung, Zeitmarker automatisch (10/30 min), Akzentfarbe auch im aktiven Schritt. 0.9.1 (20.10.2026): Viewer für alle Grafiken (Grossansicht), Detailansicht je Extremwert (Karte + Profil des Abschnitts) und numerische Fahrtaufzeichnung um den Punkt, 3D mit denselben Symbolen. 0.9.2 (20.10.2026): 3D-Ansicht flächenfüllend eingepasst (Blickrichtung Hauptachse, iterativer Zoom), Einpassen-Knopf in 3D. 0.9.3 (20.10.2026): Startseite (Formate, Anzeigename), Fusszeile, «Legal Mambojumbo»; Worker-Routen der ops-Übergabe (ohne Client). 0.10.0 (20.10.2026): Übergabe an ops.wicki.aero aus den Spezialfunktionen (Liste der letzten 20 Briefings, Dienst-Token OPS_HANDOVER_TOKEN; ops 0.14.0 zeigt die Ist-Trajektorie mit Soll/Ist) – Phase 3 ops-Übergabe umgesetzt; Spezialfunktionen an die Team-Freigabe gebunden (kein PIN im Code). 0.11.0 (20.10.2026): Logbuch über alle gespeicherten Fahrten (CSV, Druck A4 quer). 0.12.0 (20.10.2026): Import aus Garmin inReach MapShare über den Worker (Zeitfenster, Passwort durchgereicht). 0.12.1 (20.10.2026): Playwright-Smokes im Repo (tests/smoke) und in der CI. 0.13.0 (20.10.2026): Fahrtbericht als fertiges PDF vom Server (Cloudflare Browser Rendering, R2-Cache je Stand der Fahrt; Knöpfe in Schritt 5 und im Viewer). 0.14.0 (20.10.2026): Feedback – Knopf «Zu Speichern/Drucken» entfernt, Spezialfunktionen nur für Team-PINs, gb_flight_data-Auswahl in voller Breite; Ereignismarker mit Legende und Meldungsfenster im Profil, Punkte auf 2D-/3D-Karte. 0.15.0 (21.10.2026): Import aus Garmin LiveTrack (live.garmin.com – Nachfolger von MapShare für Connect/Messenger-Konten): Sessions der Seite auflisten, eine als GPX laden. 0.15.1 (21.10.2026): LiveTrack-Routen korrigiert (Response-Wrapping), Diagnoseroute, Fehlermeldungen mit Ursache. 0.15.2 (21.10.2026): Lückenschwelle und Vario-Fenster passen sich der Abtastung an (inReach 2/10 min: Strecke, Vario, Karte wieder da); eine Garmin-Karte mit Link-Erkennung (LiveTrack/MapShare), Link und Passwort im Browser gemerkt. 0.15.3 (21.10.2026): Garmin-Karte als Ablauf «Link → Weiter → Fahrtenliste oder Zeitfenster»; [hidden]-Regel im CSS. 0.15.4 (21.10.2026): Abmelden-Symbol neben dem PIN-Chip in der Kopfzeile. 0.15.5 (29.10.2026): Bericht-PDF vom Server live (CF_BR_TOKEN gesetzt, Seitenformat «a4»; erster Abruf ≈ 15 s, danach aus dem Cache).

Lieferweg je Version: Commit und Push ins Repository bwicki/analyze (GitHub Pages veröffentlicht automatisch), Worker über den GitHub-Workflow «Deploy worker» wie bei s2ground; auf Anweisung zusätzlich ein versioniertes Unterverzeichnis in der Dropbox «C:\\Users\\wpabalwic\\Dropbox\\05\_3D-Prints\\029 WebAPP Analyze» (Entscheid 18.10.2026).

## 14 Empfehlung Modell und Aufwandsstufe

Für die Algorithmen (Parser, Zusammenfügen, Start-/Landeerkennung, Exporte) lohnt sich das stärkste Modell mit hoher Aufwandsstufe, für Oberflächen-Feinschliff und Übersetzungen genügt ein mittleres Modell; eine Sitzung pro Version hält den Kontext kurz.

| Arbeitsschritt | Modell | Aufwandsstufe | Grund |
| --- | --- | --- | --- |
| Konzept, Design-Boards (jetzt) | Fable 5.1 | hoch | viele Abhängigkeiten zwischen Daten, UI und Phasen |
| Phase 1: Parser, Segmente, Erkennung, Kennzahlen, Exporte | Fable 5.1 oder Opus 5.5 | hoch | Randfälle in den Rohdaten (CR-Zeilenenden, Datumsfehler, Duplikate) |
| Phase 1: Karte, Profil, Layout, DE/EN | Sonnet 5.5 | mittel | klar umrissene UI-Arbeit nach den Boards |
| Phase 2: Worker, D1/R2, Kennungen, PIN, Supermaster | Opus 5.5 | hoch | Sicherheit und Datenhaltung |
| Phase 2: Fahrtbericht-Layout, Profil-Assistent-Dialoge | Sonnet 5.5 | mittel | Formulararbeit |
| Rückmeldungsrunden, kleine Korrekturen | Sonnet 5.5 | niedrig bis mittel | schnell und günstig |
| Phase 3: Fotos, Viewer, ops-Schnittstelle | Opus 5.5 | hoch | zwei Systeme und Dateiverarbeitung |

## 15 Entscheide vom 18.10.2026

Alle zwölf Fragen sind beantwortet; die Entscheide gelten für die Umsetzung und sind in den Abschnitten 2, 4, 5, 7, 9, 12 und 13 nachgetragen.

| Nr. | Frage | Entscheid |
| --- | --- | --- |
| 1 | Sprache | DE und EN mit Umschalter; Fahrtbericht in der gewählten Sprache |
| 2 | Tracker-Bezeichnung | vorläufig «GB-Instrument» (Profile A CSV, B JSONL) |
| 3 | Ereignislog | bwicki/gb\_flight\_data, Zugriff über den Worker mit GitHub-Token |
| 4 | Zugang | Kennung allein; nur der Supermaster meldet sich zusätzlich mit PIN an |
| 5 | Nachtfahrt | bürgerliche Dämmerung (ECCT bis MCT) |
| 6 | Beschleunigung | Das GB-Instrument misst keine Beschleunigung (Master ist ein Filterzustand). Die App leitet Vertikalbeschleunigung aus dem Vario und Horizontalbeschleunigung aus der Fahrt über Grund ab (3-s-Änderung), weist die Aufsetzgeschwindigkeit beim Landen aus und zeigt g-Werte nur bei Trackern mit echtem Sensor |
| 7 | Phasen | Phase 1 zuerst rein lokal ohne Konto liefern und abnehmen |
| 8 | Fahrtbericht | PDF über Browser-Druck mit festem Layout |
| 9 | Aufbewahrung | 2 Jahre |
| 10 | Lieferweg | Commit und Push ins Repository bwicki/analyze; auf Anweisung zusätzlich versioniert in die Dropbox «C:\\Users\\wpabalwic\\Dropbox\\05\_3D-Prints\\029 WebAPP Analyze» |
| 11 | Einheiten | ICAO (ft, kt, m/s Vario) als Vorgabe, in den Einstellungen umschaltbar |
| 12 | Viewer | Kurzlink analyze.wicki.aero/v/‹ID›, öffentlich für jeden mit Link |
