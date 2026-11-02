// Enveloppe autour de Stockfish (WebAssembly, build "lite single-thread") lancé
// comme processus enfant parlant UCI. Un petit pool de processus sert les
// requêtes ; chaque requête est exclusive sur un moteur le temps de son calcul.
// Un moteur qui plante ou ne répond plus est retiré du pool et recréé à la demande.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ENGINE_JS = path.join(path.dirname(require.resolve('stockfish/package.json')), 'bin', 'stockfish-19-lite-single.js');
const POOL_SIZE = Number(process.env.ENGINE_POOL || 2);
const SEARCH_TIMEOUT_MS = Number(process.env.ENGINE_TIMEOUT_MS || 30_000);

class Engine {
  constructor() {
    this.proc = null;
    this.buffer = '';
    this.listeners = [];   // { onLine, onExit }
    this.busy = false;
    this.dead = false;
    this.ready = this.start();
  }

  start() {
    this.proc = spawn(process.execPath, [ENGINE_JS], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (line) for (const l of [...this.listeners]) l.onLine(line);
      }
    });
    this.proc.on('error', () => this.markDead());
    this.proc.on('exit', () => this.markDead());
    return this.send('uci', l => l === 'uciok', 20_000)
      .then(() => this.send('isready', l => l === 'readyok', 20_000));
  }

  markDead() {
    if (this.dead) return;
    this.dead = true;
    this.proc = null;
    // Toutes les requêtes en attente échouent immédiatement (pas d'attente du timeout)
    for (const l of [...this.listeners]) l.onExit(new Error('Moteur arrêté'));
    this.listeners = [];
    removeFromPool(this);
  }

  // Envoie une commande ; résout quand `until(line)` est vrai (ou immédiatement
  // si `until` est absent). Renvoie toutes les lignes reçues entre-temps.
  send(cmd, until, timeoutMs = SEARCH_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.dead) return reject(new Error('Moteur arrêté'));
      const lines = [];
      if (!until) { this.proc.stdin.write(cmd + '\n'); return resolve(lines); }
      const entry = {
        onLine: line => { lines.push(line); if (until(line)) { off(); resolve(lines); } },
        onExit: err => { off(); reject(err); },
      };
      const timer = setTimeout(() => {
        off();
        // Désynchronisé : on ne sait plus à quelle recherche appartiendront les prochaines
        // réponses, donc on sacrifie ce processus plutôt que de risquer un coup d'une autre position.
        this.kill();
        reject(new Error('Délai moteur dépassé : ' + cmd));
      }, timeoutMs);
      const off = () => { clearTimeout(timer); this.listeners = this.listeners.filter(l => l !== entry); };
      this.listeners.push(entry);
      this.proc.stdin.write(cmd + '\n');
    });
  }

  kill() {
    const p = this.proc;
    this.markDead();
    try { p?.kill(); } catch { /* déjà mort */ }
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------
let engines = [];
const waiters = [];

function removeFromPool(engine) {
  engines = engines.filter(e => e !== engine);
  // Un demandeur en attente peut maintenant obtenir un nouveau moteur
  const next = waiters.shift();
  if (next) next();
}

async function acquire() {
  for (;;) {
    const free = engines.find(e => !e.busy && !e.dead);
    if (free) { free.busy = true; return free; }
    if (engines.length < POOL_SIZE) {
      const e = new Engine();
      e.busy = true;
      engines.push(e);
      try { await e.ready; return e; }
      catch (err) { e.kill(); throw err; }
    }
    await new Promise(resolve => waiters.push(resolve));
  }
}

function release(engine) {
  engine.busy = false;
  if (engine.dead) return; // déjà retiré du pool
  const next = waiters.shift();
  if (next) next();
}

// Exécute `fn(engine)` avec un moteur réservé.
export async function withEngine(fn) {
  const engine = await acquire();
  try {
    return await fn(engine);
  } finally {
    release(engine);
  }
}

// Analyse d'une position : renvoie les `multipv` meilleurs coups avec leur
// évaluation (centipions du point de vue du camp au trait, ou mate N).
export async function analyse(fen, { depth = 12, multipv = 1, moves = [] } = {}) {
  return withEngine(async (engine) => {
    await engine.send(`setoption name MultiPV value ${multipv}`);
    const pos = `position fen ${fen}${moves.length ? ' moves ' + moves.join(' ') : ''}`;
    await engine.send(pos);
    const lines = await engine.send(`go depth ${depth}`, l => l.startsWith('bestmove'));
    const best = lines.find(l => l.startsWith('bestmove'))?.split(' ')[1] || null;

    // On garde, pour chaque ligne multipv, la dernière info à la plus grande profondeur atteinte
    const byPv = new Map();
    for (const l of lines) {
      if (!l.startsWith('info ') || !l.includes(' pv ') || !l.includes(' score ')) continue;
      const m = l.match(/multipv (\d+)/);
      const pvIdx = m ? Number(m[1]) : 1;
      const cp = l.match(/score cp (-?\d+)/);
      const mate = l.match(/score mate (-?\d+)/);
      const d = Number(l.match(/depth (\d+)/)?.[1] || 0);
      const pv = l.split(' pv ')[1].split(' ');
      const prev = byPv.get(pvIdx);
      if (prev && prev.depth > d) continue;
      byPv.set(pvIdx, {
        move: pv[0], pv, depth: d,
        cp: cp ? Number(cp[1]) : null,
        mate: mate ? Number(mate[1]) : null,
      });
    }
    const list = [...byPv.values()].sort((a, b) => score(b) - score(a));
    return { bestMove: best === '(none)' ? null : best, lines: list };
  });
}

// Score scalaire comparable (mat = très grand)
export function score(line) {
  if (line.mate !== null && line.mate !== undefined) return line.mate > 0 ? 100_000 - line.mate : -100_000 - line.mate;
  return line.cp ?? 0;
}

export function shutdown() { for (const e of [...engines]) e.kill(); }
