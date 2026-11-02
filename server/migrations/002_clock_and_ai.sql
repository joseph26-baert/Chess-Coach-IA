-- Migration 002 : pendule, réglage IA et comptabilisation des parties (Phase 1b)
-- Additive uniquement.

-- Cadence : 'none' | '3+2' | '5+0' | '10+0' | '15+10' | '30+0'
ALTER TABLE games ADD COLUMN time_control TEXT NOT NULL DEFAULT 'none';
-- Temps restant du joueur en millisecondes (NULL si sans pendule)
ALTER TABLE games ADD COLUMN user_time_ms INTEGER;
-- Instant (ISO) où le trait est passé au joueur, pour décompter son temps
ALTER TABLE games ADD COLUMN user_turn_since TEXT;
-- Réglage choisi : 'weaker' | 'equal' | 'stronger'
ALTER TABLE games ADD COLUMN ai_offset TEXT NOT NULL DEFAULT 'equal';
-- 1 si la partie a compté pour l'Elo
ALTER TABLE games ADD COLUMN rated INTEGER NOT NULL DEFAULT 0;

-- Pour les coups de l'IA : perte en centipions par rapport au meilleur coup
-- (utile pour vérifier la crédibilité de l'IA et pour la calibration)
ALTER TABLE moves ADD COLUMN ai_loss_cp INTEGER;
