-- analyze – D1 schema. Apply with the "migrate" option of the deploy workflow
-- (or: npx wrangler d1 execute analyze --remote --file=worker/schema.sql). Idempotent.
--
-- Access model (concept §4, decisions of 18.10.2026):
--   * Users have a 6-letter code (Kennung) and nothing else – whoever knows the code can read,
--     save and delete that code's flights. No PIN for users.
--   * The Supermaster (admins table) logs in with a name and a PIN; only he sees all codes,
--     flights, tracker profiles and the usage log, and grants the "team" flag (Ereignislog access).
-- Existing databases (created before 0.5.1): run once  ALTER TABLE codes ADD COLUMN team INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS codes (
  code          TEXT PRIMARY KEY,            -- 6 chars, alphabet without I/O/0/1, e.g. KQZMWB
  display_name  TEXT NOT NULL DEFAULT '',
  logo_key      TEXT,                        -- R2 key logos/<code>.<ext>, NULL = default logo
  logo_type     TEXT,                        -- image/png | image/jpeg | image/svg+xml
  lang          TEXT NOT NULL DEFAULT 'de',
  units         TEXT NOT NULL DEFAULT 'icao',
  prefs         TEXT NOT NULL DEFAULT '{}',  -- JSON: default balloon, PIC, … (phase 2b)
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER,
  blocked       INTEGER NOT NULL DEFAULT 0,
  team          INTEGER NOT NULL DEFAULT 0   -- 1 = may read the Ereignislog from gb_flight_data (set by the Supermaster)
);
CREATE TABLE IF NOT EXISTS flights (
  id            TEXT PRIMARY KEY,            -- 8 chars, same alphabet; also the short link /v/<id>
  code          TEXT NOT NULL,               -- owner (codes.code)
  title         TEXT NOT NULL DEFAULT '',
  start_ts      INTEGER,                     -- ms UTC
  end_ts        INTEGER,
  stats         TEXT NOT NULL DEFAULT '{}',  -- JSON summary (takeoff, landing, duration, distance, …)
  meta          TEXT NOT NULL DEFAULT '{}',  -- JSON master data (balloon, PIC, pax, …)
  track_key     TEXT NOT NULL,               -- R2 key tracks/<id>.geojson.gz
  track_bytes   INTEGER NOT NULL DEFAULT 0,
  points        INTEGER NOT NULL DEFAULT 0,
  events_key    TEXT,                        -- R2 key events/<id>.json (phase 2b)
  public        INTEGER NOT NULL DEFAULT 1,  -- 1 = the short link works for everyone (decision 12)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flights_code ON flights(code, start_ts);
CREATE TABLE IF NOT EXISTS admins (
  name          TEXT PRIMARY KEY,            -- login name, lower case (bwicki)
  pin_hash      TEXT NOT NULL,               -- pbkdf2$<iterations>$<salt b64>$<hash b64>
  created_at    INTEGER NOT NULL,
  last_login    INTEGER
);
CREATE TABLE IF NOT EXISTS tokens (
  token         TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tracker_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  manufacturer  TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  spec          TEXT NOT NULL,               -- JSON profile (see src/parse/profiles.js)
  created_by    TEXT NOT NULL,               -- code
  public        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id            TEXT PRIMARY KEY,            -- 10 chars
  flight_id     TEXT NOT NULL,               -- flights.id
  code          TEXT NOT NULL,               -- owner
  name          TEXT NOT NULL DEFAULT '',    -- original file name
  taken_at      INTEGER,                     -- camera clock as recorded (EXIF DateTimeOriginal read as if UTC), NULL = unknown; UTC when manual = 1
  exif_tz       INTEGER,                     -- minutes east of UTC when the camera wrote OffsetTime, else NULL (the flight's camera zone applies)
  manual        INTEGER NOT NULL DEFAULT 0,  -- 1 = a hand-entered time applies (0.7.1: taken_at held it; since 0.7.3 see manual_at)
  manual_at     INTEGER,                     -- UTC ms entered by hand (overrides the camera clock; NULL = none) – the EXIF time in taken_at stays (0.7.3)
  exif_lat      REAL, exif_lon REAL, exif_alt REAL,
  caption       TEXT NOT NULL DEFAULT '',
  image_key     TEXT NOT NULL,               -- R2 photos/<flight>/<id>.jpg (resized in the browser)
  thumb_key     TEXT NOT NULL,               -- R2 photos/<flight>/<id>_t.jpg
  bytes         INTEGER NOT NULL DEFAULT 0,  -- image + thumb
  width         INTEGER, height INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_flight ON photos(flight_id, taken_at);
CREATE TABLE IF NOT EXISTS usage_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  t             INTEGER NOT NULL,            -- ms UTC
  who           TEXT NOT NULL,               -- code, 'admin:<name>' or '-'
  action        TEXT NOT NULL,
  detail        TEXT,
  ip            TEXT                         -- first two octets only
);
CREATE INDEX IF NOT EXISTS usage_t ON usage_log(t);
