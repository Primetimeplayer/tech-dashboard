-- Signal account and saved-story data

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  story_url TEXT NOT NULL,
  title TEXT,
  note TEXT NOT NULL DEFAULT '',
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, story_url)
);

CREATE INDEX IF NOT EXISTS idx_saved_items_user
  ON saved_items(user_id);

CREATE INDEX IF NOT EXISTS idx_saved_items_saved_at
  ON saved_items(user_id, saved_at DESC);
