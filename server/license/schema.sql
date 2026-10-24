-- Licence keys you sell, and the devices each key is activated on.
CREATE TABLE IF NOT EXISTS keys (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_devices INTEGER NOT NULL DEFAULT 2,
  revoked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activations (
  key TEXT NOT NULL,
  device TEXT NOT NULL,
  device_name TEXT,
  platform TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (key, device)
);
