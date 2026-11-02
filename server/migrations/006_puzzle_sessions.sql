-- Migration 006 : état serveur d'une résolution d'exercice (anti-triche) — additive.
CREATE TABLE IF NOT EXISTS puzzle_sessions (
  user_id        INTEGER NOT NULL REFERENCES users(id),
  puzzle_id      INTEGER NOT NULL REFERENCES puzzles(id),
  progress       INTEGER NOT NULL DEFAULT 0,   -- coups du joueur validés
  hints          INTEGER NOT NULL DEFAULT 0,
  solution_seen  INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, puzzle_id)
);
