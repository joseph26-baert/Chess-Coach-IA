-- Suppression de compte (RGPD) : le compte est anonymisé, jamais effacé (l'historique de jeu reste, détaché de toute identité)
ALTER TABLE users ADD COLUMN deleted_at TEXT;
