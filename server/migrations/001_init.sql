-- Migration 001 : schéma initial (Phase 1)
-- Règle du projet : les migrations sont additives, jamais destructives.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at   TEXT,

  -- Classement
  elo             INTEGER NOT NULL DEFAULT 1200,  -- Elo courant (provisoire tant que rated_games < 5)
  peak_elo        INTEGER NOT NULL DEFAULT 1200,  -- meilleur Elo historique
  rated_games     INTEGER NOT NULL DEFAULT 0,     -- nombre de parties comptabilisées

  -- Préférences
  preferred_color TEXT NOT NULL DEFAULT 'random', -- 'white' | 'black' | 'random'
  ai_offset       TEXT NOT NULL DEFAULT 'equal',  -- 'weaker' | 'equal' | 'stronger'
  show_threats    INTEGER NOT NULL DEFAULT 0,
  theme           TEXT NOT NULL DEFAULT 'dark'
);

-- Jetons de réinitialisation de mot de passe (usage unique, expirent)
CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Historique Elo : une ligne par variation, jamais modifiée ni supprimée.
-- Permet "mon Elo à une date donnée" et tous les graphiques de progression.
CREATE TABLE IF NOT EXISTS rating_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  game_id     INTEGER,                 -- partie à l'origine de la variation (NULL = initialisation)
  elo_before  INTEGER NOT NULL,
  elo_after   INTEGER NOT NULL,
  delta       INTEGER NOT NULL,
  provisional INTEGER NOT NULL DEFAULT 1,
  reason      TEXT NOT NULL DEFAULT 'game', -- 'init' | 'game'
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rating_history_user ON rating_history(user_id, created_at);

-- Parties jouées contre l'IA
CREATE TABLE IF NOT EXISTS games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  user_color    TEXT NOT NULL,                  -- 'white' | 'black'
  ai_elo        INTEGER NOT NULL,               -- force de l'IA pour cette partie
  ai_profile    TEXT NOT NULL DEFAULT 'human',  -- type d'adversaire IA
  status        TEXT NOT NULL DEFAULT 'ongoing',-- 'ongoing' | 'finished'
  result        TEXT,                           -- '1-0' | '0-1' | '1/2-1/2'
  termination   TEXT,                           -- 'checkmate' | 'resign' | 'stalemate' | 'repetition' | 'fifty' | 'insufficient'
  user_score    REAL,                           -- 1 / 0.5 / 0 du point de vue du joueur
  elo_before    INTEGER NOT NULL,
  elo_after     INTEGER,
  elo_delta     INTEGER,
  fen           TEXT NOT NULL,                  -- position courante (reprise d'une partie en cours)
  pgn           TEXT NOT NULL DEFAULT '',
  move_count    INTEGER NOT NULL DEFAULT 0,     -- demi-coups joués
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT,
  duration_s    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id, started_at);

-- Coups de chaque partie (un par demi-coup), base de l'historique et du replay
CREATE TABLE IF NOT EXISTS moves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  ply         INTEGER NOT NULL,          -- 1 = premier coup des blancs
  san         TEXT NOT NULL,
  uci         TEXT NOT NULL,
  fen_after   TEXT NOT NULL,
  by_user     INTEGER NOT NULL,          -- 1 si joué par l'utilisateur, 0 par l'IA
  time_ms     INTEGER,                   -- temps de réflexion
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(game_id, ply)
);
