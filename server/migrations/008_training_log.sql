-- Journal d'entraînement : activités hors site (cours, livres, vidéos, tournois, parties ailleurs),
-- et relevés d'Elo externes. Historique additif, jamais effacé (suppression logique).
CREATE TABLE IF NOT EXISTS training_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,                 -- 'lesson' | 'book' | 'video' | 'tournament' | 'games' | 'other' | 'rating'
  title       TEXT NOT NULL,
  minutes     INTEGER,                       -- durée (NULL pour un relevé d'Elo)
  rating      INTEGER,                       -- Elo externe relevé (kind = 'rating')
  platform    TEXT,                          -- 'chess.com' | 'lichess' | 'fide' | 'club' | …
  note        TEXT,
  happened_on TEXT NOT NULL,                 -- date (YYYY-MM-DD)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_training_log_user ON training_log(user_id, happened_on);
