CREATE TABLE IF NOT EXISTS scans (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 market_date TEXT,
 universe_id TEXT NOT NULL,
 rules_name TEXT NOT NULL,
 compatibility_key TEXT NOT NULL,
 complete INTEGER NOT NULL CHECK (complete IN (0,1)),
 processed INTEGER NOT NULL,
 total INTEGER NOT NULL,
 qualified INTEGER NOT NULL,
 payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_owner_created ON scans(user_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS watchlist (
 user_id TEXT NOT NULL,
 symbol TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 added_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (user_id, symbol)
);
