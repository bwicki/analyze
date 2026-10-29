# Fahrtanalyse/Fahrtbericht — analyze.wicki.aero

Wertet die Aufzeichnungen beliebiger Tracker einer Ballonfahrt aus und macht daraus die Grundlage für das
Logbuch: Dateien importieren, zusammenfügen und bereinigen, Start und Landung erkennen, Karte (2D und 3D),
Höhenprofil mit Gelände und Wasser, Kennzahlen, Ereignislog, Fotos, druckbarer Fahrtbericht (A4/PDF), Exporte
in GPX/GeoJSON/KMZ/CSV, Speichern unter einem persönlichen PIN mit Kurzlink, QR-Code und Viewer für Dritte.
Zweisprachig DE/EN, handytauglich, keine Installation.

**Live:** https://analyze.wicki.aero · **Repository:** https://github.com/bwicki/analyze ·
**API:** Cloudflare Worker `analyze-api` (`worker/`) mit D1 (Datenbank) und R2 (Tracks, Fotos, Logos, Vorschaubilder)
**Stack:** HTML/CSS/JS ohne Build-Schritt (ES-Module, GitHub Pages aus dem Repository-Stamm), Leaflet für die
2D-Karte, MapLibre GL für die 3D-Ansicht (wird erst beim ersten Aufruf geladen), IBM Plex. Gestaltung, Tokens
und Bedienidiom aus GaforCast/StueveCast/ops.

> **Auswertungshilfe ohne Gewähr.** Die Kennzahlen entstehen aus den Trackerdaten so, wie sie aufgezeichnet
> wurden. Flughandbuch (AFM), Flugbuchpflichten und amtliche Produkte sind massgebend.

Stand: Version 0.15.6 (29.10.2026) — Phase 1 (Analyse lokal) und Phase 2 (Worker: PIN, Speichern, Kurzlink,
Viewer, Supermaster, Ereignislog, Profil-Assistent) abgeschlossen, Phase 3 begonnen (Fotos, mehrere Geräte,
Gelände/Wasser, 3D, Link-Vorschau, Übergabe an ops.wicki.aero). Offen: Stammdaten-Übergabe aus ops.wicki.aero. Konzept:
`docs/Konzept_analyze_v0.1.md`; Design-Boards (Phase 0): `design/`.

---

## Die App von oben nach unten

### Startseite und persönlicher PIN

Beim ersten Laden fragt die App nach dem **persönlichen PIN** (sechs Zeichen, im Code und in der API weiterhin
«Kennung»/`code`): «Neuen PIN erzeugen» (einmal notieren) oder einen vorhandenen eingeben. Der PIN ist das
einzige Geheimnis — wer ihn kennt, sieht und ändert die Fahrten darunter; er bleibt im Browser und geht nur als
Header `X-Code` an den eigenen Worker. «Ohne PIN ausprobieren» = reiner Browserbetrieb ohne Speichern (Phase 1).
Ohne Worker (`apiBase` in `src/config.js` leer) startet die App direkt im Import. Beim **ersten Besuch** öffnet
sich für sechs Sekunden ein kleines Fenster (DE/EN umschaltbar; Zeiger darüber hält es an), das erklärt, was die
Seite macht und dass sie sich mit einem PIN auf das eigene Ballonteam personalisieren lässt; ☰ → «Einführung
anzeigen» zeigt es wieder.

Kopfzeile: Titel «Fahrtanalyse/Fahrtbericht», darunter der **Team-/Organisationsname** des PIN (Profil; leer =
«Wickipartners Ballonteam»), rechts das **Logo** des PIN (eigenes oder das Ballonteam-Logo), der **PIN-Chip**
(Klick → Meine Fahrten) mit dem **Abmelden-Symbol** daneben (ab 0.15.4: entfernt den PIN nach Rückfrage aus diesem
Browser, die Fahrten bleiben gespeichert), DE/EN und das Menü ☰ (Einstellungen, Supermaster). Die fünf Schritte stehen als Chips: Importieren · Bereinigen · Auswerten · Bericht ·
Speichern/Drucken/Exportieren; die Aktionsleiste darunter führt mit «Weiter zu …» durch den Ablauf.

### 1 · Importieren

Dateien oder ein ganzes ZIP (z. B. `gb26_data.zip`) ins Feld ziehen oder wählen. Erkannt werden GB-Instrument
CSV/JSONL, GPX 1.0/1.1, KML/KMZ (Google Earth, Garmin inReach), IGC, aprs.fi CSV/JSON sowie alle Formate, für
die ein Profil existiert (siehe *Neues Trackerprofil*). Grosse Logs (80 MB) werden in einem Web Worker gelesen, die Seite bleibt
bedienbar. Je Datei entstehen **Segmente** (Zeitsprünge rückwärts > 60 s oder Lücken trennen); doppelte
Aufzeichnungen (CSV + JSONL desselben Geräts) werden einmal verwendet, Segmente weit ausserhalb der Hauptfahrt
(> 12 h) gelten als **andere Fahrt** und lösen eine Rückfrage aus («Ignorieren» / «Trotzdem verwenden»). Die
importierten Dateien selbst bleiben als **Rohdaten** in der Sitzung und werden beim Speichern der Fahrt mitgesichert.

**Garmin inReach – eine Karte für LiveTrack und MapShare (ab 0.15.2):** ein Feld «Garmin-Link» und «Weiter»
(oder Enter); die App erkennt am Host, was gemeint ist, und zeigt danach entweder die Fahrten der LiveTrack-Seite
oder Zeitfenster und Passwort für MapShare. Link und MapShare-Passwort werden in diesem Browser gemerkt
(Einstellungen, `garmin`), sodass der eigene Link beim nächsten Mal schon dasteht – der Worker speichert nichts.

- **LiveTrack** (`live.garmin.com/‹Name›`, auch `livetrack.garmin.com/‹Name›` oder ein Session-Link
  `livetrack.garmin.com/session/‹ID›/token/‹Token›`; ab 0.15.0): inReach-Geräte, die über Garmin Connect/Messenger
  teilen, haben statt MapShare eine LiveTrack-Seite – dort gibt es weder Download noch KML-Feed. «Weiter»
  listet die öffentlichen Sessions der Seite (Name, Start, Dauer, Strecke, max. Höhe; laufende zuerst),
  «Laden» holt die Positionen einer Session als GPX (Zeit,
  Höhe, Geschwindigkeit; der künstliche END-Punkt beim Schliessen der Session wird weggelassen) und importiert sie
  wie eine Datei (`livetrack_<Name>_<Datum>.gpx`). Der Worker (`GET /api/livetrack/sessions`,
  `GET /api/livetrack/track`; PIN, 30 Abrufe je 10 min) spricht die interne JSON-Schnittstelle der LiveTrack-Seite
  an: Seite laden (CSRF-Cookie und Meta-Token), `api/personal-url/‹Name›/user`, `api/v2/user/‹GUID›/profile-sessions`,
  `api/sessions/‹ID›/track-points/common?token=`. Undokumentiert, Stand 21.10.2026 – ändert Garmin die Seite,
  meldet die Karte «Garmin antwortet nicht» mit der Ursache in Klammern. Seiten mit Passcode werden nicht
  unterstützt. Prüfroute ohne PIN: `GET /api/livetrack/diag?share=‹Name›` (nur Statuscodes).
- **MapShare** (`share.garmin.com/…`, Garmin Explore; ab 0.12.0): Zeitfenster (Lokalzeit, Vorgabe die letzten 24 h,
  max. 31 Tage) und falls gesetzt das MapShare-Passwort → «Von MapShare laden» holt den KML-Feed über den Worker
  (`GET /api/mapshare`, nur Garmin-Hosts, 20 Abrufe je 10 min und PIN; Garmin sendet keine CORS-Header) und
  importiert ihn wie eine Datei (`mapshare_<Name>_<Datum>.kml`, auch in den Rohdaten). Das Passwort wird erst
  gemerkt, wenn es einmal funktioniert hat, und geht nur an Garmin.

**Grobe Aufzeichnungen (ab 0.15.2):** inReach-Tracks kommen alle 2 min (LiveTrack) bzw. alle 10 min (MapShare).
Die Lückenschwelle (Vorgabe 30 s) passt sich der Abtastung an – drei Intervalle, höchstens eine Stunde –, und der
Vario wird über ein Intervall statt ±2 s abgeleitet; «Bereinigen → Lücken» zeigt die angehobene Schwelle. Vorher
war bei solchen Daten jeder Abschnitt eine Lücke: Strecke 0, kein Vario, kein Track auf der Karte.

**Mehrere Geräte** (ab 0.8.0): zeichnen zwei oder mehr Tracker dieselbe Fahrt auf, erscheint die Karte «Mehrere
Geräte». *Konsens (Median)* bildet im überlappenden Bereich pro Rasterpunkt (5–60 s, Vorgabe 10 s) den Median von
Position und Höhe aller Geräte; ein Gerät weiter als 300 m vom Median wird dort verworfen. *Hauptgerät +
Lückenfüllung* nimmt ein Gerät und füllt nur dessen Lücken aus den anderen. Ausserhalb der Überlappung behält jedes
Gerät seine volle Auflösung. Der gewählte Modus steht im Protokoll und im Bericht.

### 2 · Bereinigen

Zeitleiste der ganzen Aufzeichnung: Zustandsbalken (in Fahrt blau, am Boden grau), Segmentbalken, Neustarts und
Lücken, Nachtbänder, darunter das **Höhenprofil der ganzen Aufzeichnung** mit Gelände (grau) und Wasser (blau),
sobald geladen — so sieht man sofort, ob vor dem Start oder nach der Landung noch Punkte liegen. Der **Schnitt**
hat zwei schlanke Griffe (Ziehen mit Vorschau; Pfeiltasten 10 s, mit Shift 1 min, mit Alt 10 min), dazu die
Zeitfelder (UTC) und Schritt-Knöpfe ±10 s / ±1 min / ±10 min; «Automatisch» stellt den Vorschlag wieder her
(2 min vor dem ersten Start bis 2 min nach der letzten Landung). Doppelklick auf die Zeitleiste oder der Knopf ⤢
öffnet sie **gross im Viewer** (Griffe funktionieren dort ebenso; × oben rechts oder Esc schliesst).

**Ein Schnitt in der Fahrt gilt als Start bzw. Landung** (✂): Kennzahlen, Bericht und Exporte folgen den
geänderten Zeiten — man kann also vom Bericht zurück nach Bereinigen, die Startzeit anpassen und den Ablauf
erneut durchlaufen. Liegt der Schnitt am letzten Punkt einer Aufzeichnung, die in der Fahrt endet, bleibt es bei
«keine Landung erkannt»; **Landung von Hand setzen** öffnet dann den Dialog mit Karte des Aufzeichnungsendes,
Zeitfeld/Schieberegler/Klick auf den Track und Landeort (Vorschlag aus OpenStreetMap, überschreibbar). Eine von
Hand oder per Schnitt gesetzte Landung wird mit der Fahrt gespeichert und beim Öffnen wiederhergestellt.
Fälschlich erkannte **Zwischenlandungen** (Richtungsumkehr, Stillstand) entfernt das × — die Abschnitte werden
zusammengefügt (wiederherstellbar). Die Karte «Start- und Landeerkennung» zeigt Zeiten und Positionen, «Neu
erkennen» wiederholt die Erkennung; das **Protokoll der Aufbereitung** (Dateien, Duplikate, unlesbare Zeilen,
verworfene Zeitstempel, Lücken, Neustarts, ausgeblendete Höhensprünge, Geräte) wird im Bericht abgedruckt.

### 3 · Auswerten

**Karte:** Auswerten öffnet in der **3D-Ansicht** (Vorgabe seit 0.9.0; der Schalter 2D/3D merkt sich die Wahl),
Farbe nach Vario (oder Fahrt über Grund) in fünf Stufen, Nachtabschnitte (NVFR) dunkler, Zeitmarker
(**automatisch**: alle 10 min bis 5 h Fahrt, darüber alle 30 min; wählbar 10 min bis 3 h), Start/Landung/
Zwischenlandungen und die **Extremwerte** als Symbole: ◆ Höhe max., ▲ Steigen max., ▼ Sinken max., ▶ Fahrt max.
(mit Wert und Zeit als Tooltip). 2D: Layer Strasse/Topo/Satellit als Radiobuttons oben rechts, Knopf ⤢ passt die
Fahrt exakt ein (bruchteilige Zoomstufe, auch Vorgabe). Maus über Karte oder
Profil zeigt den Punkt im jeweils anderen; Klick hält ihn fest (Pin); die Karte schiebt den Ausschnitt nach, damit
der Marker sichtbar bleibt. Darunter zwei **Detailkarten** von Startort und Landeort mit Datum und Zeit.

**Grossansicht (Viewer, ab 0.9.1):** jede Grafik lässt sich bildschirmfüllend öffnen — Knopf ⤢ (bei der 2D-Karte
links unter dem Einpassen-Knopf, bei 3D unter dem Kompass, sonst oben rechts in der Grafik), bei Höhenprofil und
Zeitleiste auch per Doppelklick, bei Detailkarten, Berichtsgrafiken und dem Vorschaubild per Klick. Karte und
3D-Ansicht wandern samt Zustand (Zoom, Pin, Layer) in den Viewer und zurück; × oben rechts, Esc oder ein Klick
neben den Viewer schliessen.

**3D** (ab 0.8.0, Vorgabe ab 0.9.0): kippbare Karte (MapLibre GL, ca. 1 MB, nur online; ohne WebGL oder offline
fällt die Ansicht auf 2D zurück) mit Gelände und Reliefschattierung; die Fahrt steht als **Vorhang** vom Boden bis
zur Fahrthöhe auf der Karte (Farben wie 2D, Nacht dunkler, dunkle Oberkante = Höhenprofil), Überhöhung **10×**
(Vorgabe; automatisch oder 1–100×, wird gemerkt), Layerwahl oben rechts, Hover/Pin aus dem Profil als Pfosten,
Extremwerte als dieselben Symbole ◆ ▲ ▼ ▶ wie in Kennzahlen und 2D. Die Fahrt wird **flächenfüllend eingepasst**
(ab 0.9.2): Blickrichtung entlang der Hauptachse der Fahrt (Start links, Landung rechts; wenig gestreckte Fahrten
Nord oben), Zoom iterativ auf die projizierten Punkte samt Vorhang statt auf das geografische Rechteck; Knopf ⤢ unter
dem Kompass passt erneut ein. Rechte Maustaste oder Ctrl + Ziehen dreht und kippt, Mausrad zoomt.
Gelände und 3D lassen sich in den Einstellungen abschalten.

**Höhenprofil** (Zeit oder Strecke als x-Achse): Höhe nach Vario gefärbt, Nachtbänder, Zeitmarker, Maximalhöhe,
Extremwert-Symbole ◆ ▲ ▼ ▶,
**Geländeprofil** (grau; Terrarium-DEM-Kacheln, Ersatz open-meteo) und **Wasserflächen** (blau; Meer aus den
Höhendaten, Seen und Flüsse aus OpenFreeMap-Vektorkacheln; über Wasser ist die Oberfläche 0 m die Basislinie,
der Gewässerboden — Bathymetrie des DEM — lässt sich als braune gestrichelte Linie zuschalten), Fahrt über Grund
als zweite Spur, Ballast-Restbestand aus dem Ereignislog (rechte Skala). Readout mit Zeit, Höhe, Vario, Fahrt,
Position, «Über Grund». Die y-Achse beginnt bei einer runden Stufe unterhalb des tiefsten Werts.

**Kennzahlen** (ICAO ft/kt oder metrisch, umschaltbar): Start und Landung mit Datum, UTC und Lokalzeit (aus der
Länge), Ortsnamen im Format `CH-Willisau` (OpenStreetMap Nominatim, Ersatz Photon; «Ortsnamen ermitteln»
wiederholt den Abruf; nach einem verschobenen Schnitt wird der Name der neuen Position geholt), Landungen und
Zwischenlandungen mit Bodenzeit, Dauer und Fahrtzeit, Strecke und Luftlinie auf dem WGS84-Ellipsoid (Vincenty) mit
Kurs, Höhe max. GPS/Baro und Mittel, Steigen/Sinken max. (30-s-Mittel), Fahrt über Grund max./Mittel, vertikale
und horizontale Beschleunigung (über 3 s), Aufsetzrate, Nachtfahrt (bürgerliche Dämmerung, Sonne −6°) mit
Zeitfenstern, Segmente/Neustarts/Lücken, Tracker und Batterie. Bei Höhe max., Steigen/Sinken max. und Fahrt max.
steht ein **Symbolknopf** (◆ ▲ ▼ ▶ — dasselbe Zeichen wie auf Karte, 3D-Ansicht und Höhenprofil; in den Kacheln
und in der Liste). Er hält den Punkt überall fest (Pin) und öffnet die **Detailansicht** (ab 0.9.1): ein Viewer
mit Karte und Höhenprofil des Abschnitts ± 5/10/30 min um den Punkt (Minutenpunkte, Beschriftung alle 5 min,
übrige Fahrt grau, gekoppelter Hover und Readout; Klick hält einen Punkt fest, auch in der Hauptansicht). Ein Klick
auf ein Symbol in Karte, 3D-Ansicht oder Profil öffnet dieselbe Detailansicht. Der **Listenknopf** ≡ (in der Liste
und oben in der Detailansicht, «Aufzeichnung») zeigt die **numerische Fahrtaufzeichnung** um den Punkt: Trackpunkte
± 1/5/30 min mit Zeit, Höhe (bereinigt) und Baro, Vario und Vario 30 s, GS und GS 10 s (die gleitenden Mittel, aus
denen die Kennzahlen stammen), Kurs, Breite/Länge, Fix und Batterie; die Zeile des Extremwerts ist markiert.
«Tabelle kopieren» legt alles als Text in die Zwischenablage; «In Google Earth öffnen» sichert eine KMZ mit
Zeitregler.

**Ereignislog:** «Aus gb_flight_data verknüpfen» (abgeschlossene Fahrten der Reporting-App; nur PINs mit
Team-Freigabe, Worker-Token nötig) oder «Datei (JSON/CSV)». Ereignisse erscheinen als **farbige Punkte** (Farbe je
Typ: ATC blau, Ballast orange, Ressourcen grün, Position grau, PIC violett, Sonstiges hellgrau; Fotos als 📷) auf
der 2D-Karte (eigene Ebene über den Zeitmarkern), in der 3D-Ansicht und im Höhenprofil (Punkt auf der Linie,
Strich an der Zeitachse), dazu seit 0.14.0 eine **Legende** unter dem Profil (Typen mit Anzahl) und ein
**Meldungsfenster**: Zeiger über einen Punkt zeigt Zeit, Typ, Ort, Meldung und Melder – eng beieinander liegende
Ereignisse in einem Fenster; Tippen/Klick hält das Fenster fest (Touch), ein Klick daneben schliesst es. Die Karte
zeigt dieselbe Meldung als Tooltip. Darunter die Tabelle mit Δ (Abstand gemeldete Position ↔ Track), filterbar nach
Typ (ausgeblendete Typen verschwinden auch aus Karte, Profil und Legende); Maus über eine Zeile zeigt den Punkt.
Das Log wird mit der Fahrt gespeichert (Viewer und «Öffnen» zeigen es; der Bericht trägt die Legende mit).

**Fotos** (braucht eine gespeicherte Fahrt): «Fotos hinzufügen» nimmt JPEGs von Kamera oder Handy, liest die
Aufnahmezeit (EXIF) und legt jedes Bild auf den Track; Bilder werden im Browser auf 2000 px verkleinert
(+ Vorschaubild) und unter dem PIN gespeichert. «Kamerazeit» = Zeitzone der Kamera-Uhr (EXIF-Zonen neuerer Handys
werden direkt verwendet), «Feinkorrektur» für vor-/nachgehende Uhren, «Aus GPS-Fotos vorschlagen» bestimmt die
Zone aus Fotos mit GPS-Position. **Zeit von Hand (UTC)** für Fotos ohne EXIF (Screenshots, WhatsApp) oder bei
falsch gestellter Uhr: eintippen oder Punkt auf Karte/Profil anklicken und «📍 Pin übernehmen»; die EXIF-Zeit
bleibt gespeichert, × stellt sie wieder her. Bildtext je Foto, Klick → Grossansicht. Viewer und Bericht
(Fotoseite, bis 24 Bilder) zeigen die Fotos.

### 4 · Bericht

Stammdaten eintragen: Titel, Anlass, Zweck (privat/gewerblich/Wettfahrt/Schulung), Ballon mit Muster/Volumen und
«Ergänzungen zur Ausrüstung», PIC, Co-Pilot, Passagiere (kommagetrennt), Nachfahrer, Command Center, Startort und
Landeort (überschreiben die ermittelten Namen), NVFR (automatisch aus der Nachtzeit oder von Hand), Bemerkungen.
Die Stammdaten bleiben im Browser und werden mit der Fahrt gespeichert.

Rechts die Vorschau des Berichts: Titel «Fahrt vom ‹Datum› (Start hh:mm UTC – Landung hh:mm UTC)», Logo und
Team-/Organisationsname, bei gespeicherter Fahrt **QR-Code und Kurzlink oben rechts** (vor dem Speichern steht dort
am Bildschirm ein Platzhalter, im Druck nichts). Seite 1 Stammdaten (zweispaltig) und Kennzahlen, Seite 2
Übersichtskarte, Detailkarten von Startort und Landeort, Höhenprofil, Seite 3 Segmente/Protokoll, Regeln der
Erkennung und Unterschrift mit «Daten hochgeladen / letzte Änderung», dann Ereignislog und Fotos. Gedruckt wird in
Schritt 5 (der Hinweis über der Vorschau sagt das; der Knopf «Zu Speichern/Drucken» entfiel in 0.14.0); im Viewer (Kurzlink-Besucher ohne Schritt 5) steht der Druckknopf direkt hier. Karte, Detailkarten und
Höhenprofil des Berichts öffnen per Klick oder ⤢ gross (interaktive Kopie mit Layerwahl und Zoom).

**Spezialfunktionen** (unten; seit 0.14.0 nur für PINs, die der Supermaster für das Team freigegeben hat – der
Supermaster-Token allein zeigt das Kästchen nicht; seit 0.10.0 steht kein PIN mehr im Code): Ereignislog aus
`gb_flight_data` verknüpfen – Auswahlfenster in voller Breite mit den Fahrten des Repositories, passende Fahrten
nach Zeitraum markiert, «Verknüpfen» – und **«Track übergeben» an ops.wicki.aero** (0.10.0, Phase 3):
die gespeicherte Fahrt (zuerst Schritt 5) wird mit Trajektorie (GeoJSON, auf ~30 s ausgedünnt), Kennzahlen,
Stammdaten des Berichts, Viewer-Link und Ereignislog-Verweis – ohne Fotos – an ein Briefing übergeben; man wählt es
aus der Liste der letzten 20 Briefings, eine zweite Übergabe ersetzt die erste, der Stand («zuletzt übergeben an
Briefing … am …», Link «in ops öffnen») bleibt in den Stammdaten der Fahrt. Der Worker spricht mit dem ops-Worker
über das Dienst-Token `OPS_HANDOVER_TOKEN` (beide Repositories, GitHub-Secret; der Browser sieht es nie; ab 0.15.6 im
Header als `b64u:` + base64url, damit auch Sonderzeichen im Secret den Transport überstehen). In ops
erscheint die Fahrt als Abschnitt «F · Ist-Trajektorie» mit Soll/Ist-Vergleich (die Worker-Routen nehmen weiterhin
auch den Supermaster-Token an).

### 5 · Speichern/Drucken/Exportieren

Fünf nummerierte Karten mit je einem blauen Aktionsknopf:

1. **Unter dem persönlichen PIN speichern** — legt den geschnittenen Track (volle Auflösung, gzip-GeoJSON),
   Kennzahlen, Stammdaten, das Ereignislog und die **Rohdaten** (die importierten Trackerdateien, im Browser
   gzip-komprimiert; bis 24 Dateien, 25 MB je Datei und 80 MB je Fahrt komprimiert, zählen zum Speicher des PIN)
   ab, erzeugt den Kurzlink `analyze.wicki.aero/v/‹ID›` und zeichnet das **Vorschaubild** für Messenger (1200 × 630,
   JPEG < 300 KB: Kartenkacheln des gewählten Layers, Fahrt exakt eingepasst (bruchteilige Zoomstufe), Track nach
   Vario gefärbt, Start/Landung, Bildzeile mit Titel, Dauer, Strecke, Zeiten). «Nochmals speichern» aktualisiert
   die Version; die Rohdaten werden nur neu geladen, wenn sich der Dateisatz geändert hat.
2. **Bericht drucken / PDF** — öffnet Schritt 4 und nach dem Kartenaufbau den Druckdialog des Browsers («Als PDF
   sichern»); man bleibt danach im Bericht. Ist die Fahrt noch nicht gespeichert, fragt die App «Zuerst speichern,
   dann drucken / Ohne Link drucken / Abbrechen» — nur ein gespeicherter Bericht trägt Kurzlink und QR-Code.
3. **Dateien herunterladen** — Auflösung (jeder Punkt / 10 s / 60 s), Auswahlkästchen GPX 1.1, GeoJSON, KML/KMZ
   (Google Earth mit Zeitregler), CSV (SI, Semikolon) und **Alles als ZIP** (GPX, GeoJSON, KML + KMZ, CSV,
   Kennzahlen als JSON und Text, Stammdaten, Ereignislog, README); ZIP graut die Einzelformate aus. Knopf
   «Ausgewählte herunterladen» (bei mehreren Dateien fragt der Browser einmal). Dateiname aus Datum und Titel.
4. **Teilen · Viewer** — Kurzlink mit «Link kopieren», QR-Code, «Viewer öffnen», **«Bericht-PDF»** (ab 0.13.0:
   fertiges PDF vom Server, ohne Druckdialog – nur bei aktivem Kurzlink, siehe «Bericht-PDF vom Server»),
   «Kurzlink deaktivieren» (Fahrt privat) und das Vorschaubild, wie es Messenger beim Teilen zeigen.
5. **Weitergabe an andere Programme** — «KMZ sichern» für Google Earth (die Übergabe an ops.wicki.aero steht bei
   den Spezialfunktionen im Bericht).

### Viewer und Link-Vorschau

Der Kurzlink `analyze.wicki.aero/v/‹ID›` zeigt Auswerten und Bericht ohne PIN, ohne Bearbeiten, mit Logo und
Team-/Organisationsname des Eigners, Ereignislog und Fotos. Messenger (WhatsApp, Signal, Slack …) lesen für die
Vorschau die Open-Graph-Tags einer Seite, ohne JavaScript auszuführen. Darum legt der Worker für jede
öffentliche Fahrt die Seite `v/‹ID›/index.html` im Repository ab (Titel «Fahrtanalyse/Fahrtbericht – HB-QPJ –
AMBC26 (Start 15.10.2026)», Beschreibung mit Start, Landung, Dauer, Strecke, Vorschaubild, Weiterleitung in die
App) — beim Speichern, Ändern, Privat-Schalten (entfernt) und Löschen. Die Vorschau erscheint rund eine Minute
nach dem Speichern (GitHub-Pages-Build).

### Bericht-PDF vom Server

Ab 0.13.0 liefert `‹API›/api/view/‹ID›/report.pdf` den Fahrtbericht einer **öffentlichen** Fahrt als fertiges PDF
(A4, Kopf mit QR-Code, Karten, Profil) — Knopf «Bericht-PDF» in Schritt 5 und «PDF laden» im Viewer; ein Link,
der sich wie jede Datei weitergeben lässt. Der Worker lässt dafür Cloudflare **Browser Rendering** (wie
ops.wicki.aero für die Wetterblätter) die Viewer-Seite `/?v=‹ID›&pdf=1#report` öffnen: die App springt direkt in
den Bericht, zeichnet Karten und Profil und meldet mit `html[data-print-ready]`, dass alles steht; gedruckt wird
mit den Druck-Stylesheets der App (`emulateMediaType: print`). Das PDF liegt danach in R2 (`pdfs/‹ID›-‹Stand›.pdf`)
und wird bis zur nächsten Änderung der Fahrt direkt ausgeliefert (erster Abruf 10–20 s, danach sofort); Ändern,
Privat-Schalten und Löschen räumen es weg. Private Fahrten drucken weiterhin über den Browser (Schritt 5 ·
Karte 2). Ohne die Secrets `CF_BR_TOKEN`/`CF_ACCOUNT_ID` antwortet die Route mit 503; der Supermaster sieht den
Status unter «Tokens». Höchstens 20 Abrufe je Minute und Adresse.

### Meine Fahrten und Profil

Klick auf den PIN oben rechts: Liste der eigenen Fahrten (Öffnen ohne Neu-Import, Kurzlink kopieren, **Rohdaten (n)**
= die importierten Trackerdateien als ZIP zurückholen, Löschen). **Logbuch** (0.11.0): alle gespeicherten Fahrten
als Tabelle (Datum, Start/Landung UTC mit Ort, Dauer, Nacht, Strecke, Luftlinie, Höhe max., Landungen, Ballon,
PIC/Copilot, Pax, Zweck, Fahrt) mit Jahresfilter und Summen – **CSV** für Excel (Semikolon, UTF-8 BOM) oder
**Drucken/PDF** (A4 quer mit Logo und Teamname); aus den gespeicherten Kennzahlen, ohne Track zu laden.
**Profil** mit Anzeigename, **Team / Organisation** (ersetzt «Wickipartners Ballonteam» unter dem App-Titel, im
Viewer und im Bericht), **Akzentfarbe** (Farbwähler oder Hex-Wert; Linie unter dem Berichtskopf und die Markierung des aktiven Schritts in
der Kopfzeile, Vorgabe das Ballonteam-Gelb; gilt auch im Viewer und im Druck), **eigenes Logo** (PNG/JPEG/SVG/WebP ≤ 1 MB; sonst das Ballonteam-Logo in App, Viewer und
Berichten), Vorgaben (Standard-Ballon, PIC), Abmelden. Je PIN 300 MB Speicher.

### Supermaster

☰ → Supermaster oder `#admin`: einmalig Name + Supermaster-PIN einrichten, danach Login (Token 12 h). Tabs
**PINs** (sperren/freigeben, löschen, **Team-Zugang** für das Ereignislog aus gb_flight_data), **Fahrten** (alle
PINs; **Rohdaten (n)**: die importierten Trackerdateien jeder Fahrt als ZIP (eine Datei direkt), dazu «Track» =
gespeicherter Track als GeoJSON und «Ereignislog» als JSON; jeder Abruf steht im Nutzungsprotokoll; Löschen), **Profile** (geteilte Trackerprofile), **Nutzung** (Protokoll). Die Kopfzeile zeigt
Anzahl PINs/Fahrten/Speicher/Aktionen und ob die Worker-Tokens (`GH_DATA_TOKEN`, `GH_PAGES_TOKEN`,
`OPS_HANDOVER_TOKEN`, `CF_BR_TOKEN`) hinterlegt sind — nur gesetzt/fehlt, nie der Wert.

### Einstellungen (☰)

Einheiten (ICAO oder metrisch), Zeitmarker (automatisch oder fest), Ortsnamen ermitteln (an/aus), Gelände/Wasser/3D (an/aus),
Experte: Lückenlänge (30 s), Abstand «andere Fahrt» (12 h), Erkennungsfenster und Schwellen (siehe
*Rechenmodelle*), Trimm-Reserve; Zurücksetzen. Die Schwellen werden im Bericht mitgedruckt.

---

**Legal Mambojumbo** (☰ und Fusszeile, 0.9.3): private Anwendung ohne kommerzielle Nutzung, keine Haftung von Wicki
Aero GmbH und Balthasar Wicki, Daten werden gespeichert, aber Dritten nicht zur Verfügung gestellt, Drittanbieter beim
Laden von Karten/Gelände/Ortsnamen, schweizerisches Recht, Kontakt balthasar@wicki.aero (DE/EN nach Sprache).

## Rechenmodelle

* **Zusammenfügen:** Segmente je Datei nach Zeitsprüngen; Duplikate über gleiche Zeitfenster und Geräteprofile;
  Lücken > 30 s bleiben sichtbar; Höhen-Ausreisser werden maskiert (ausserhalb −500…15 000 m, symmetrische
  Sprünge, > 500 m gegenüber dem Median der ±5 Nachbarn). Mehrere Geräte: Konsens-Median oder Hauptgerät.
* **Start-/Landeerkennung:** gleitendes Vorwärtsfenster 120 s über Fahrt über Grund und |Vario|; in Fahrt ab
  GS > 2.5 kt oder |Vario| > 0.4 m/s, am Boden ab GS < 1 kt und |Vario| < 0.25 m/s; Hüpfer < 120 s und
  Bodenkontakte < 60 s zählen nicht; der genaue Zeitpunkt wird auf den letzten ruhigen bzw. bewegten Punkt
  (5-s-Mittel) geschnappt. Ein Schnitt in der Fahrt ersetzt Start bzw. Landung.
* **Trimmen:** Vorschlag 2 min vor dem ersten Start bis 2 min nach der letzten Landung; Exporte, Speichern und
  Kennzahlen beziehen sich auf den Schnitt.
* **Kennzahlen:** Strecke und Luftlinie auf WGS84 (Vincenty), Vario-Extrema als 30-s-Mittel, Fahrt über Grund als
  10-s-Mittel, Beschleunigungen als Ableitung über 3 s, Aufsetzrate aus den 5 s vor der Landung, Nacht nach
  bürgerlicher Dämmerung (Sonne −6°) entlang des Tracks.
* **Gelände:** bis 1500 Stützpunkte entlang des Tracks aus Terrarium-DEM-Kacheln (Ersatz open-meteo); DEM ≤ 0 m =
  Meer (Oberfläche 0 m, Boden als Bathymetrie); Seen und Flüsse aus OpenFreeMap-Vektorkacheln (eigener MVT-Leser,
  Punkt-in-Polygon). Höhe über Grund = GPS-Höhe − Gelände.
* **Vorschaubild:** exakte Web-Mercator-Einpassung der Fahrt in 1200 × 566 px (bruchteilige Zoomstufe: Kacheln der
  nächsthöheren ganzen Stufe werden herunterskaliert), Kacheln des gewählten Layers (Ersatz OSM, sonst
  Grundfarbe), JPEG-Qualität wird gesenkt, bis die Datei unter 280 KB liegt.

## Woher die Daten kommen

Alles läuft im Browser; die eigenen Daten gehen nur an den eigenen Worker (Speichern, Fotos) und — beim
Speichern — als Vorschaubild. Fremddienste: Kartenkacheln von OpenStreetMap (ODbL, © OpenStreetMap-Mitwirkende),
OpenTopoMap (CC-BY-SA) und Esri World Imagery; Ortsnamen von Nominatim (OSM) mit Ersatz Photon (komoot);
Höhendaten als Terrarium-Kacheln (Mapzen/AWS Open Data) mit Ersatz open-meteo; Wasserpolygone von OpenFreeMap;
Leaflet 1.9.4 von cdnjs, MapLibre GL 5.24 von unpkg, IBM Plex von Google Fonts; Ereignislog aus dem privaten
Repository `bwicki/gb_flight_data` über den Worker. Ortsnamen, Gelände und 3D lassen sich abschalten.

## Betrieb

* **App:** GitHub Pages aus dem Repository-Stamm (`main`), Domain `analyze.wicki.aero` (CNAME bei united-domains auf
  `bwicki.github.io`; die Zone liegt nicht bei Cloudflare, darum keine Worker-Route). Kurzlinks `/v/‹ID›` werden
  von `404.html` in die App geleitet, sofern keine Vorschauseite existiert. Ersatzadresse `bwicki.github.io/analyze/`.
* **Worker:** `analyze-api` auf workers.dev (Adresse in `src/config.js`, `apiBase`), D1 `analyze` (Tabellen
  `codes`, `flights`, `photos`, `raw_files`, `tracker_profiles`, `admins`, `tokens`, `usage_log`), R2 `analyze`
  (`tracks/`, `events/`, `raw/`, `photos/`, `logos/`, `previews/`). Tabellen und Spalten, die nach der ersten Migration dazukamen, legt der Worker
  beim ersten Aufruf selbst an. Täglicher Cron: Fahrten 730 Tage nach der letzten Änderung löschen
  (`RETENTION_DAYS`), abgelaufene Tokens und alte Protokollzeilen entfernen. Limiten: 300 MB je PIN (`QUOTA_MB`,
  Tracks und Rohdaten), Track ≤ 25 MB komprimiert, Rohdaten ≤ 24 Dateien / 25 MB je Datei / 80 MB je Fahrt
  (komprimiert), Logo ≤ 1 MB, Vorschaubild ≤ 600 KB. CORS nur für `APP_ORIGINS`.
* **Deploy:** `.github/workflows/deploy.yml` deployt den Worker bei jedem Push unter `worker/` (und manuell mit
  Schema-Migration); `.github/workflows/tests.yml` führt die Tests bei jedem Push aus. Secrets liegen nur in GitHub
  Secrets, `wrangler.toml` enthält keine.
* **Versionen:** `VERSION` in `src/state.js`, Fusszeile der App; Verlauf in `docs/Konzept_analyze_v0.1.md`
  (Abschnitt Stand). Jede Version liegt als Kopie im Projektordner (Dropbox `v‹Version›`).

### Einrichten (einmalig, nur Browser)

1. **GitHub Pages:** Repo → Settings → Pages → Source «Deploy from a branch», Branch `main`, Ordner `/ (root)`;
   Custom domain `analyze.wicki.aero` (aus `CNAME`), DNS-CNAME `analyze` → `bwicki.github.io`, Enforce HTTPS.
2. **D1-Datenbank:** Cloudflare-Dashboard → Storage & Databases → D1 → Create → Name `analyze`; Database ID in
   `worker/wrangler.toml` eintragen.
3. **R2-Bucket:** R2 Object Storage → Create bucket → `analyze` (Location hint Western Europe).
4. **API-Token:** My Profile → API Tokens → Vorlage «Edit Cloudflare Workers» + Account · D1 · Edit + Account ·
   Workers R2 Storage · Edit, auf das Konto eingeschränkt.
5. **GitHub-Secrets** im Repo `bwicki/analyze` (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`.
6. **Deployen mit Schema:** Actions → «Deploy worker» → Run workflow mit Haken «migrate» (legt die Tabellen an);
   danach genügt jeder Push unter `worker/`. Adresse `https://analyze-api.‹subdomain›.workers.dev` in
   `src/config.js` (`apiBase`) und `worker/wrangler.toml` (`API_URL`) eintragen; Test `/api/health`.
7. **Supermaster:** `https://analyze.wicki.aero/#admin` → Name + PIN (einmalig).
8. **Ereignislog (optional):** GitHub → Settings → Developer settings → Fine-grained token, Repository access nur
   `bwicki/gb_flight_data`, Contents: Read-only, Ablauf ≤ 1 Jahr → als Secret `GH_DATA_TOKEN` hinterlegen (GitHub
   erlaubt keine Namen mit `GITHUB_`; im Worker `GITHUB_DATA_TOKEN`) → «Deploy worker» einmal laufen lassen → im
   Supermaster den PINs des Ballonteams «Team-Zugang geben».
9. **Link-Vorschau (optional):** zweiter Fine-grained token, Repository access nur `bwicki/analyze`, Contents:
   Read and write, Ablauf ≤ 1 Jahr → Secret `GH_PAGES_TOKEN` (im Worker `GITHUB_PAGES_TOKEN`) → «Deploy worker».
   Ohne Token bleibt der Kurzlink ohne Vorschau. Zum Testen liefert der Worker die Seite auch selbst:
   `analyze-api.‹subdomain›.workers.dev/v/‹ID›`.
10. **Übergabe an ops.wicki.aero (optional, 0.10.0):** ein langer Zufallstext (≥ 32 Zeichen, Passwortmanager) als
    Secret `OPS_HANDOVER_TOKEN` **in beiden Repositories** (`bwicki/analyze` und `bwicki/ops`) → in beiden «Deploy
    worker» einmal laufen lassen. Der Supermaster sieht den Status unter «Tokens» (gesetzt/fehlt, nie den Wert);
    `worker/wrangler.toml` nennt die ops-Adressen (`OPS_API_URL`, `OPS_APP_URL`).
11. **Bericht-PDF vom Server (optional, 0.13.0):** Cloudflare → My Profile → API Tokens → Create Token → Custom
    Token mit der Berechtigung **Browser Rendering: Edit** für das Konto (dasselbe Token wie `cf_api_token` von
    ops.wicki.aero eignet sich, wenn es diese Berechtigung trägt) → als Secret `CF_BR_TOKEN` in `bwicki/analyze`
    → «Deploy worker» einmal laufen lassen (legt im Worker `CF_BR_TOKEN` und `CF_ACCOUNT_ID` aus
    `CLOUDFLARE_ACCOUNT_ID` ab). Browser Rendering ist im Workers-Paid-Plan enthalten (Kontingent: Browser-
    Minuten pro Tag); ohne Secret bleibt der Knopf ohne Wirkung (503), die App druckt wie bisher.

## Tests

```
node --test tests/*.test.js      # Rechentests (52)
npm run smoke                     # Browser-Durchläufe (Playwright, Chromium)
```

52 Rechentests: Leser und Profile, Zusammenfügen und Konsens, Erkennung, Schnitt in der Fahrt, Kennzahlen auf den
verdünnten GB26-Daten (Start 23:31 UTC, Landung 16:34 UTC, 41 h 03 min, ≈ 1 590 km WGS84, 1 Neustart, 2 Nächte),
Exporte, GeoJSON-Rundlauf (gespeicherte Fahrt öffnet mit denselben Segmenten und Kennzahlen), Gelände und MVT,
Vorschaubild, Fotos/EXIF, QR-Code, Logbuch, Worker-API mit D1/R2-Attrappen (PIN, Fahrten, Viewer, Vorschauseite,
Bild, Fotos, Supermaster, Rohdaten und Rohdateien, Token-Status), ops-Übergabe, MapShare und LiveTrack mit Netz-Attrappen,
Vollständigkeit der Übersetzungen.

**Browser-Durchläufe** (`tests/smoke/`, ab 0.12.1 im Repo und in der CI): `run.mjs` startet einen statischen Server
der Arbeitskopie und führt die Skripte nacheinander aus – Einführungsfenster, Legal, Rückweg Bericht → Bereinigen,
Extremwerte, Viewer/Detailansicht/Fahrtaufzeichnung, Landung von Hand und Fotos, Druckfluss, Schritt 5 und
Akzentfarbe, Rohdateien und Ereignislog, Logbuch, ops-Übergabe, MapShare, LiveTrack. Kacheln, Ortsnamen, Gelände und MapLibre
sind gesperrt oder durch `leaflet_stub.js` ersetzt, die Worker-API durch Routen im Skript; ein Durchlauf gilt als
bestanden, wenn er mit 0 endet, «errors: none» meldet und seine Kennzeilen druckt (Tabelle in `run.mjs`).
Voraussetzung lokal: `npm install --no-save playwright` und `npx playwright install chromium` (oder
`PW_CHROMIUM=<Pfad zu Chromium>`); Screenshots landen unter `$TMPDIR/analyze-smoke`. Der Workflow `tests.yml`
führt beide Stufen bei jedem Push aus und hängt die Screenshots als Artefakt an.

## Neues Trackerprofil

Wird eine Datei nicht erkannt, erscheint unter Importieren «Format unbekannt» mit **Profil-Assistent öffnen**:
(1) Datei lesen — Trennzeichen, Kopfzeile, Dezimalzeichen erkannt und änderbar; (2) Spalten zuordnen — Vorschläge
je Normfeld aus Spaltennamen und Wertebereichen (Zeit als eine Spalte oder Datum + Zeit, Einheiten m/ft,
kt/km/h/m/s, cm/s/ft/min, V/%), Vorschau mit Zeitraum, Fix-Punkten, Höhen und Trackskizze; (3) Benennen und
speichern — mit PIN wird das Profil über den Worker **für alle PINs** geteilt, ohne PIN bleibt es im Browser.
Erkannt werden CSV/TSV, JSON Lines und JSON-Arrays; GPX/KML/IGC sind fest eingebaut. Fest eingebaute Profile
stehen in `src/parse/profiles.js` (gleiches JSON-Format), die beiden GB-Instrument-Profile dienen als Vorlage.

## Dateien

| Ordner / Datei | Inhalt |
|---|---|
| `index.html`, `css/app.css`, `i18n/de.json`, `en.json`, `img/` | Die App (eine Seite), Sprachen, Logo und Icons |
| `src/app.js`, `state.js`, `config.js`, `session.js`, `api.js`, `flightio.js`, `i18n.js` | Bootstrap und Routing, Zustand/Pipeline/Einstellungen, Worker-Adresse, PIN im Browser, Worker-Client, Speichern/Öffnen von Fahrten und Vorschaubild |
| `src/parse/` | Trackerprofile (`profiles.js`), Leser CSV/JSONL/GPX/KML/IGC (`readers.js`), ZIP ohne Fremdbibliothek (`zip.js`), Profil-Assistent (`assist.js`) |
| `src/process/` | Segmente und Zusammenfügen (`segments.js`), mehrere Geräte (`consensus.js`, `mergeinfo.js`), Reihen (`series.js`), Erkennung und Schnitt (`detect.js`), Kennzahlen (`stats.js`), Track für Anzeige/Export (`track.js`) |
| `src/terrain/` | Gelände und Wasser: DEM-Kacheln/open-meteo (`terrain.js`), MVT-Leser (`mvt.js`), Cache und Anzeige (`store.js`) |
| `src/events/log.js`, `src/photos/` | Ereignislog (Normalisierung, Verknüpfung), Fotos (EXIF, Verkleinern, Platzierung, Speicher) |
| `src/export/` | GPX/GeoJSON/KML/KMZ/CSV (`formats.js`), Downloads und ZIP (`download.js`), Vorschaubild (`preview.js`) |
| `src/ui/` | Kopfzeile und Aktionsleiste, die fünf Schritte, Karte 2D (`map.js`) und 3D (`map3d.js`), Höhenprofil (`profile.js`), Ereignis- und Fotokarten, Start, Meine Fahrten, Supermaster, Profil-Assistent, Einführungsfenster (`welcome.js`), Viewer für Grossansicht, Detailansicht und Fahrtaufzeichnung (`viewer.js`), Logbuch (`logbook.js`), Legal (`legal.js`) |
| `src/util/` | DOM-Helfer und Dialoge, Formate, Einheiten, Geodäsie (Vincenty, Dämmerung), Ortsnamen, QR-Code (eigener Code) |
| `src/worker/parse-worker.js` | Parser im Web Worker |
| `worker/` | Cloudflare Worker: `wrangler.toml`, `schema.sql`, `src/` (Routing, PINs, Fahrten, Rohdateien, Fotos, Ereignislog, Profile, Supermaster, Vorschauseiten, ops-Übergabe, MapShare, LiveTrack, Bericht-PDF) |
| `v/‹ID›/index.html` | Vom Worker abgelegte Vorschauseiten öffentlicher Fahrten |
| `404.html`, `CNAME`, `.nojekyll` | Kurzlink-Umleitung, Domain, Pages-Einstellung |
| `tests/` | Automatische Tests mit Fixtures (verdünnte GB26-Logs, Fotos, Ereignislog) |
| `docs/` | Konzept (Markdown und Word) |
| `design/` | Freigegebene Design-Boards (Phase 0) |
| `.github/workflows/` | Tests und Worker-Deploy |

## API (Worker)

`POST /api/codes` · `GET|PUT /api/me` · `PUT|DELETE /api/me/logo` · `GET /api/logo/‹code›` ·
`GET|POST /api/flights` · `GET|PUT|DELETE /api/flights/‹id›` · `GET /api/flights/‹id›/track|events` ·
`PUT /api/flights/‹id›/preview` (JPEG ≤ 600 KB) · `GET|POST /api/flights/‹id›/raw`, `GET /api/flights/‹id›/raw/‹n›`
(Rohdaten: multipart `meta` + `files` gzip) · `GET|POST /api/flights/‹id›/photos`, `PUT|DELETE
/api/flights/‹id›/photos/‹pid›` · `GET /api/profiles` (öffentlich), `POST /api/profiles`, `DELETE
/api/profiles/‹id›` · `GET /api/events/flights`, `/api/events/‹Fahrt›`, `/api/events/media/‹Datei›` (Team-PINs oder Supermaster-Token) ·
`GET /api/flights/‹id›/ops/briefings`, `POST /api/flights/‹id›/ops` (Übergabe an ops.wicki.aero; Team-PINs oder Supermaster) ·
`GET /api/mapshare?share=&from=&to=[&pw=]` (Garmin MapShare-Feed als KML, PIN) · `GET /api/livetrack/sessions?share=`, `GET /api/livetrack/track?share=&session=&token=` (Garmin LiveTrack: Sessions, eine Session als GPX; PIN) ·
öffentlich: `GET /api/view/‹id›[/track|/events|/photos|/preview.jpg|/report.pdf]` (PDF: Browser Rendering, R2-Cache), `GET /api/photos/‹pid›[/thumb]`,
`GET /v/‹id›` (Vorschauseite) · Supermaster (Bearer-Token): `/api/admin/setup|login|logout|me|pin|stats|codes|
flights|log|profiles|cleanup`, `GET /api/admin/flights/‹id›/track|events|raw`, `GET /api/admin/flights/‹id›/raw/‹n›` (Rohdaten), `DELETE
/api/admin/flights/‹id›`, `POST /api/admin/codes/‹code›/block|unblock|team`, `DELETE /api/admin/codes/‹code›`.
PIN als Header `X-Code`. Speichern = multipart `meta` (JSON) + `track` (gzip GeoJSON) + `events` (JSON);
Foto = multipart `meta` + `image` + `thumb` (JPEG).

## Lizenz

Alle Rechte vorbehalten; Quelltext zur Einsicht veröffentlicht. Jede Nutzung über das Lesen hinaus nur mit
vorheriger ausdrücklicher Zustimmung von Balthasar Wicki / Wicki Aero GmbH und mit Quellenangabe — siehe
`LICENSE` (DE/EN). Zur Laufzeit geladene Drittkomponenten: Leaflet (BSD-2-Clause), MapLibre GL JS (BSD-3-Clause),
IBM Plex (OFL 1.1); Karten- und Höhendaten gemäss ihren Quellen (siehe *Woher die Daten kommen*). Logo und Name
«Wicki Partners Ballonteam» sind nicht Teil der Lizenz; hochgeladene Tracks, Fotos und Stammdaten bleiben
Eigentum der Nutzer.
