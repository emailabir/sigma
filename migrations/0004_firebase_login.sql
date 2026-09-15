CREATE TABLE firebase_accounts (
 project_id TEXT NOT NULL,
 firebase_uid TEXT NOT NULL,
 user_id TEXT NOT NULL,
 PRIMARY KEY(project_id, firebase_uid),
 UNIQUE(project_id, user_id)
);
CREATE TABLE firebase_sessions (
 token_hash TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 firebase_uid TEXT NOT NULL,
 user_id TEXT NOT NULL,
 email TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX firebase_sessions_expiry ON firebase_sessions(expires_at);
CREATE INDEX firebase_sessions_owner ON firebase_sessions(project_id,user_id,created_at);
