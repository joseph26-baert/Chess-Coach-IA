-- Migration 004 : analyse automatique des parties (Phase 3)
-- Additive uniquement.

-- Une analyse par partie (relancée si on ré-analyse : l'ancienne ligne est conservée, la plus récente fait foi)
CREATE TABLE IF NOT EXISTS analyses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id        INTEGER NOT NULL REFERENCES games(id),
  user_id        INTEGER NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'running' | 'done' | 'error'
  engine_depth   INTEGER NOT NULL DEFAULT 12,
  progress       INTEGER NOT NULL DEFAULT 0,        -- demi-coups analysés
  -- Résumé (joueur) : précision en %, nombre d'erreurs par gravité
  accuracy_user  REAL,
  accuracy_ai    REAL,
  inaccuracies   INTEGER,
  mistakes       INTEGER,
  blunders       INTEGER,
  acpl_user      REAL,                              -- perte moyenne en centipions par coup
  summary        TEXT,                              -- JSON : moments décisifs, meilleurs coups, forces, faiblesses, recommandations
  error_message  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_analyses_game ON analyses(game_id, id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);

-- Évaluation de chaque demi-coup (les deux camps)
CREATE TABLE IF NOT EXISTS move_evals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id   INTEGER NOT NULL REFERENCES analyses(id),
  game_id       INTEGER NOT NULL REFERENCES games(id),
  ply           INTEGER NOT NULL,
  by_user       INTEGER NOT NULL,
  eval_before   INTEGER NOT NULL,     -- centipions, point de vue des blancs, mats = ±10000 ∓ N
  eval_after    INTEGER NOT NULL,
  best_uci      TEXT,
  best_san      TEXT,
  played_san    TEXT NOT NULL,
  loss_cp       INTEGER NOT NULL,     -- perte du coup joué (point de vue du camp qui joue, ≥ 0)
  label         TEXT NOT NULL,        -- 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
  motifs        TEXT,                 -- JSON : liste de motifs détectés (ex. ["hanging-piece"])
  explanation   TEXT,                 -- phrase en français
  UNIQUE(analysis_id, ply)
);
CREATE INDEX IF NOT EXISTS idx_move_evals_game ON move_evals(game_id, ply);

-- Erreurs du joueur rattachées à une catégorie de faiblesse (base de la Phase 4)
CREATE TABLE IF NOT EXISTS error_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  game_id      INTEGER NOT NULL REFERENCES games(id),
  analysis_id  INTEGER NOT NULL REFERENCES analyses(id),
  ply          INTEGER NOT NULL,
  category     TEXT NOT NULL,         -- 'tactics' | 'calculation' | 'strategy' | 'openings' | 'endgames' | 'defense' | 'material' | 'threats'
  motif        TEXT NOT NULL,
  severity     TEXT NOT NULL,         -- 'inaccuracy' | 'mistake' | 'blunder'
  loss_cp      INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_error_events_user ON error_events(user_id, created_at);
