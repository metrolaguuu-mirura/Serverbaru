-- Table servers untuk menyimpan m3u8 dari berbagai provider
-- Jalankan: npx wrangler d1 execute megaplay-db --file=schema.sql

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL,
  server_name TEXT NOT NULL DEFAULT 'megaplay',
  lang TEXT NOT NULL DEFAULT 'sub',
  anilist_id INTEGER NOT NULL,
  episode_num INTEGER NOT NULL,
  file_id TEXT,
  m3u8_url TEXT,
  tracks TEXT DEFAULT '[]',
  intro_start REAL,
  intro_end REAL,
  outro_start REAL,
  outro_end REAL,
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ep_server ON servers(episode_id, server_name, lang);
CREATE INDEX IF NOT EXISTS idx_ani_ep ON servers(anilist_id, episode_num, lang);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_server ON servers(episode_id, server_name, lang);
