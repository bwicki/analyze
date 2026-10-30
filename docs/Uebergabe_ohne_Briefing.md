# Übergabe an ops.wicki.aero ohne bestehendes Briefing

Schnittstellenkonzept analyze ↔ ops, Stand 30.10.2026 (analyze 0.15.7). Die analyze-Seite ist umgesetzt und wartet
auf das Signal `canCreate` von ops; die ops-Seite (Abschnitt 4) ist offen.

## 1 Ausgangslage

Heute übergibt analyze eine gespeicherte Fahrt nur an ein **bestehendes** Briefing: `PUT
/api/handover/briefings/‹id›/trajectory` mit dem Paket (Trajektorie, Kennzahlen, Stammdaten, Viewer-Link,
Ereignislog-Verweis). Fahrten ohne Briefing – Trainingsfahrten, nachträglich ausgewertete Fahrten, Fahrten anderer
Teams – können nicht übergeben werden; ops kennt keinen Datensatz, an den die Ist-Trajektorie hängen könnte.

Ziel: Die Übergabe legt in ops die **Stammdaten der Fahrt** an (Datum/Zeit, Startort, Ballon, Besatzung, Zweck,
Herkunft), hängt die Trajektorie daran und lässt den **Briefing-Teil leer**. Der Datensatz erscheint in der
Briefing-Liste wie jedes andere Briefing (mit Ordnungsnummer des Fahrtjahres) und kann später ergänzt oder so
belassen werden.

## 2 Ablauf aus Sicht des Nutzers

1. Schritt 5 · Karte 5 (oder Bericht → Spezialfunktionen) → «Übergabe an ops.wicki.aero».
2. Das Auswahlfenster zeigt die letzten 20 Briefings **und** – sobald ops `canCreate: true` meldet – als letzte
   Zeile «＋ Neue Fahrt ohne Briefing anlegen» (Hinweis: «ops.wicki.aero legt die Stammdaten der Fahrt aus analyze
   an – der Briefing-Teil bleibt leer»). Vorausgewählt ist das Briefing der letzten Übergabe dieser Fahrt, sonst das
   neueste; die Zeile «Neue Fahrt» ist vorausgewählt, wenn die Liste leer ist.
3. «Übergeben» → Meldung «Neue Fahrt 2026-014 auf ops.wicki.aero angelegt (241 Punkte)»; der Stand («zuletzt
   übergeben an Briefing 2026-014 am …», Link «in ops öffnen») bleibt in den Stammdaten der Fahrt. Eine zweite
   Übergabe derselben Fahrt trifft wieder denselben Datensatz (Vorauswahl + Dublettenschutz in ops, Abschnitt 4.3).

## 3 analyze-Seite (umgesetzt in 0.15.7)

- `GET /api/flights/‹id›/ops/briefings` reicht `canCreate` aus der ops-Antwort durch (`false`, solange ops das Feld
  nicht liefert → die Zeile «Neue Fahrt» erscheint nicht).
- `POST /api/flights/‹id›/ops` mit `{ "briefingId": "new" }` → der Worker sendet das bekannte Paket (Format 1) per
  `POST /api/handover/briefings` an ops, ergänzt um `create: { by: ‹Kennung› }`. Antwort an den Browser:
  `{ ok, briefingId: ‹neue id›, no: ‹Ordnungsnummer›, created: true, url, receivedAt, points }`.
- Fehler: ops-Fehlertext und Route wandern in die Meldung («ops.wicki.aero: briefing not found (PUT
  /api/handover/briefings/‹id›/trajectory)»), fehlgeschlagene Übergaben stehen als `ops_handover_failed` (Status +
  Text, nie das Token) und Listenfehler als `ops_list_failed` im Nutzungsprotokoll des Supermasters.
- Der Workflow «ops handover check» (`.github/workflows/ops-check.yml`, manuell) prüft das Dienst-Token, die Liste
  und die PUT-Route gegen den ops-Worker und meldet nur Statuscodes.

## 4 ops-Seite (offen – Vorschlag)

### 4.1 Route

`POST /api/handover/briefings` · Header `X-Handover-Token` wie bisher (Rohwert oder `b64u:`) · Body = Paket Format 1
(`source, format, sentAt, flight, stats, meta, events, trajectory`) + `create: { by }`.

Antwort 201: `{ ok: true, id, no, url, receivedAt, points, created: true }` · 200 mit `created: false`, wenn der
Dublettenschutz (4.3) einen bestehenden Datensatz aktualisiert hat · 400/413 wie bei `PUT …/trajectory`.

`GET /api/handover/briefings` liefert zusätzlich `canCreate: true` – analyze blendet die Zeile «Neue Fahrt» erst damit
ein, ops kann die Funktion also jederzeit ohne Abstimmung freischalten oder abschalten.

### 4.2 Anlegen des Datensatzes

Ein normales Briefing-JSON über `saveBriefing(...)`, damit Ordnungsnummer, Revision, Zusammenfassung und Listen
wie gewohnt funktionieren:

| Briefing-Feld (ops) | Quelle im Paket | Bemerkung |
| --- | --- | --- |
| `id` | `newId()` | – |
| `no` | `nextNo(env, Fahrtjahr)` | Fahrtjahr aus `flight.startTs`; Nummer wie bei einem Nachtrag |
| `status` | `'draft'` | kein neuer Statuswert nötig; `origin` kennzeichnet die Herkunft (unten) |
| `origin` (neu) | `{ source: 'analyze', flightId: flight.id, url: flight.url, by: create.by, receivedAt }` | Kennzeichen «Nachtrag aus analyze»; Grundlage des Dublettenschutzes |
| `title` | `flight.title` | – |
| `time.startMs` / Landung | `flight.startTs` / `flight.endTs` (Unix ms) | `end_ms` nach ops-Regel (Landung + 6 h) |
| `site.name` | `meta.startName`, sonst Ortsname des Startpunkts (`trajectory` Feature `kind: 'takeoff'`) | – |
| `site.icao` | Koordinatencode aus dem Startpunkt (Form `4455N00943E`) | ops führt solche Codes bereits für Startorte ohne ICAO |
| `site.elev` | Höhe des Startpunkts | aus dem Takeoff-Feature |
| `site.tz` | Zeitzone des Eigners (Profil) | Rückfall `Europe/Zurich` |
| `balloon.reg` / `label` | `meta.balloon` / `meta.balloon · meta.type` (+ `meta.volume`) | Material des Eigners **nicht** verknüpfen (keine Freigabeprüfung) |
| `crew` | `meta.pic`, `meta.copilot`, `meta.pax`, `meta.crew` | als Text, wie im analyze-Bericht |
| `flight.kind` | `meta.purpose` (`private`/`commercial`/`competition`) | auf ops-Werte abbilden |
| `flight.event` | `meta.event` | z. B. «GB26» |
| Briefing-Abschnitte (Wetter, Luftraum, NOTAM, Dokumente, Freigaben) | – | leer; keine automatischen Abrufe anstossen |

Danach `putTrajectory(env, ctx, id, pkg, …)` wie bei der bestehenden Route (gleiche Validierung, R2-Ablage, Tabelle
`trajectories`). Nutzungsprotokoll: `briefing_create` mit Zusatz `analyze ‹flightId›` und der bestehende
Handover-Eintrag.

### 4.3 Eigner und Dublettenschutz

- **Eigner:** Das Dienst-Token kennt keinen Nutzer. Vorschlag: Einstellung `handover_owner` (kv) – der Eigner, bei
  dem Übergaben ohne Briefing landen; fehlt sie, der Eigner des jüngsten Briefings. Der Supermaster von ops setzt
  sie einmal (Einstellungen → «Übergaben aus analyze»).
- **Dublette:** Existiert bereits ein Briefing mit `origin.flightId = flight.id` (Spalte oder `json_extract`), wird
  dessen Trajektorie ersetzt und der Datensatz zurückgegeben (`created: false`) – kein zweiter Datensatz für dieselbe
  analyze-Fahrt. Übergaben an ein bestehendes, von Hand angelegtes Briefing bleiben davon unberührt.

### 4.4 Anzeige in ops

- Briefing-Liste: Kennzeichen «Nachtrag aus analyze» (aus `origin`), Trajektorie-Datum wie heute.
- Öffnen: direkt auf Abschnitt «F · Ist-Trajektorie»; die leeren Briefing-Abschnitte bleiben bearbeitbar, der
  Soll/Ist-Vergleich entfällt, solange keine Soll-Bahn vorliegt (Hinweis statt Fehler).
- Archivgrenze, Links `?t=`/`?mt=` und Löschen wie bei jedem Briefing.

## 5 Aufwand und Reihenfolge

1. ops: Route + Anlegen + `canCreate` (Worker, ca. 120 Zeilen; Tests mit D1/R2-Attrappen) – 1 Version (0.14.4).
2. ops: Einstellung `handover_owner`, Kennzeichen in Liste und Briefingsicht – dieselbe oder die nächste Version.
3. analyze: nichts mehr; nach dem ops-Deploy erscheint die Zeile «Neue Fahrt» von selbst. Ende-zu-Ende-Test mit
   einer gespeicherten Fahrt (Team-PIN), Kontrolle im Nutzungsprotokoll beider Seiten.
