// Couche base de données : SQLite via better-sqlite3.
// Principe : migrations ADDITIVES uniquement (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN).
// Aucune migration ne supprime ni n'écrase de données historiques.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'chess-coach.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');      // écritures concurrentes sûres
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ---------------------------------------------------------------------------
// Migrations : chaque fichier server/migrations/NNN_nom.sql est appliqué une
// seule fois, dans l'ordre. La table `schema_migrations` garde la trace.
// ---------------------------------------------------------------------------
export function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const insert = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    if (/\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i.test(sql)) {
      throw new Error(`Migration ${file} refusée : les suppressions de données sont interdites.`);
    }
    db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    })();
    console.log(`[db] migration appliquée : ${file}`);
  }
}

// Petit utilitaire : date ISO (UTC) courante
export const now = () => new Date().toISOString();
