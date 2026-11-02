-- Migration 005 : entraînement (Phase 4). Additive uniquement.

-- Exercices : bibliothèque (user_id NULL) et exercices personnels tirés des parties du joueur
CREATE TABLE IF NOT EXISTS puzzles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,                  -- 'library' | 'game'
  user_id     INTEGER REFERENCES users(id),   -- propriétaire pour les exercices personnels
  game_id     INTEGER REFERENCES games(id),
  ply         INTEGER,                        -- demi-coup de la partie d'origine (position avant le coup joué)
  fen         TEXT NOT NULL,
  fen_key     TEXT NOT NULL,                  -- position sans compteurs, pour dédoublonner
  solution    TEXT NOT NULL,                  -- JSON : coups UCI (le joueur joue les coups 0, 2, 4…)
  themes      TEXT NOT NULL,                  -- JSON : liste de thèmes
  rating      INTEGER NOT NULL,               -- difficulté estimée (Elo d'exercice)
  mate_in     INTEGER,
  gain_cp     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_puzzles_key ON puzzles(fen_key, COALESCE(user_id, 0));
CREATE INDEX IF NOT EXISTS idx_puzzles_source ON puzzles(source, rating);
CREATE INDEX IF NOT EXISTS idx_puzzles_user ON puzzles(user_id, created_at);

-- Chaque tentative est conservée (jamais écrasée)
CREATE TABLE IF NOT EXISTS puzzle_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  puzzle_id   INTEGER NOT NULL REFERENCES puzzles(id),
  result      TEXT NOT NULL,                  -- 'solved' | 'solved-hint' | 'failed'
  hints       INTEGER NOT NULL DEFAULT 0,
  time_ms     INTEGER,
  rating_before INTEGER,                      -- niveau du joueur sur le thème principal avant la tentative
  rating_after  INTEGER,
  theme       TEXT,                           -- thème principal crédité
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON puzzle_attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_puzzle ON puzzle_attempts(user_id, puzzle_id);

-- Répétition espacée : prochaine échéance par exercice
CREATE TABLE IF NOT EXISTS puzzle_schedule (
  user_id       INTEGER NOT NULL REFERENCES users(id),
  puzzle_id     INTEGER NOT NULL REFERENCES puzzles(id),
  due_at        TEXT NOT NULL,
  interval_days REAL NOT NULL DEFAULT 1,
  reps          INTEGER NOT NULL DEFAULT 0,   -- réussites consécutives
  lapses        INTEGER NOT NULL DEFAULT 0,   -- échecs
  retired       INTEGER NOT NULL DEFAULT 0,   -- maîtrisé : ne revient plus
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, puzzle_id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_due ON puzzle_schedule(user_id, retired, due_at);

-- Niveau du joueur par thème (Elo d'exercice), avec compteurs
CREATE TABLE IF NOT EXISTS theme_ratings (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  theme       TEXT NOT NULL,
  rating      INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  solved      INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, theme)
);

-- Scores de faiblesse par catégorie (0-100), historisés à chaque recalcul
CREATE TABLE IF NOT EXISTS weakness_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  category     TEXT NOT NULL,
  score        INTEGER NOT NULL,
  errors_20g   INTEGER NOT NULL DEFAULT 0,   -- erreurs pondérées sur les 20 dernières parties
  puzzle_rate  REAL,                          -- taux de réussite récent aux exercices de la catégorie
  computed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_weakness_user ON weakness_scores(user_id, category, computed_at);
