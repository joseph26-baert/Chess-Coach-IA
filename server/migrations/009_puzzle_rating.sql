-- Difficulté des exercices affinée par les résultats réels des joueurs (Elo de l'exercice)
ALTER TABLE puzzles ADD COLUMN rating_initial INTEGER;   -- estimation d'origine (conservée)
ALTER TABLE puzzles ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;   -- premières tentatives (hors révisions)
ALTER TABLE puzzles ADD COLUMN solved INTEGER NOT NULL DEFAULT 0;
UPDATE puzzles SET rating_initial = rating WHERE rating_initial IS NULL;
