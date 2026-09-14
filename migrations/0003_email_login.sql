-- Existing scans/watchlists keep their user_id. Invitations explicitly map a
-- verified email to that ID; no accounts are linked by guessed email matches.
CREATE TABLE IF NOT EXISTS email_identities (
 email TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS email_sessions (
 token_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 user_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_sessions_owner ON email_sessions(user_id,created_at DESC,token_hash DESC);
CREATE INDEX IF NOT EXISTS email_sessions_expiry ON email_sessions(expires_at);
CREATE TABLE IF NOT EXISTS email_challenges (
 flow_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS email_challenges_expiry ON email_challenges(expires_at);
CREATE TABLE IF NOT EXISTS auth_limits (
 bucket TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_limits_expiry ON auth_limits(expires_at);
