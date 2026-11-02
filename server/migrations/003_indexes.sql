-- Migration 003 : index pour l'historique et les requêtes de forme récente
CREATE INDEX IF NOT EXISTS idx_games_user_status_finished ON games(user_id, status, finished_at);
