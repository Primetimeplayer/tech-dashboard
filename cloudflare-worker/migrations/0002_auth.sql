-- Authentication and sessions

ALTER TABLE users ADD COLUMN provider TEXT;
ALTER TABLE users ADD COLUMN provider_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_subject
  ON users(provider, provider_subject);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
  ON sessions(expires_at);
