// Tests HTTP de bout en bout : santé, référencement, inscription, suppression de compte (anonymisation),
// e-mail de réinitialisation (transport factice).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-coach-http-'));
process.env.ANALYSIS_AUTO = '0';
process.env.PORT = '0';
process.env.BASE_URL = 'https://exemple.test';
process.env.ENGINE_POOL = '1';
const { default: app } = await import('../server/index.js');
const { db } = await import('../server/db.js');
const { shutdown } = await import('../server/engine/stockfish.js');

let base;
const server = app.listen(0);
before(async () => { await new Promise(r => server.on('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); shutdown(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); setTimeout(() => process.exit(0), 300); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: r.status, json, text, type: r.headers.get('content-type') };
  };
}

test('santé, robots, sitemap, page avec adresse publique', async () => {
  const c = client();
  assert.deepEqual((await c('GET', '/healthz')).json, { ok: true });
  const robots = await c('GET', '/robots.txt');
  assert.match(robots.text, /Disallow: \/api\//); assert.match(robots.text, /https:\/\/exemple\.test\/sitemap\.xml/);
  const sitemap = await c('GET', '/sitemap.xml');
  assert.match(sitemap.text, /<loc>https:\/\/exemple\.test\/<\/loc>/);
  const home = await c('GET', '/');
  assert.match(home.text, /rel="canonical" href="https:\/\/exemple\.test\/"/);
  assert.ok(!home.text.includes('__BASE_URL__'));
  assert.match(home.text, /Chess Coach IA/);
  assert.equal((await c('GET', '/api/inexistant')).status, 404);
  assert.match((await c('GET', '/#/confidentialite')).type, /html/);
});

test('inscription, suppression de compte : anonymisation, connexion refusée, parties conservées', async () => {
  const c = client();
  const reg = await c('POST', '/api/auth/register', { email: 'sup@t.l', username: 'suppr', password: 'motdepasse1' });
  assert.equal(reg.status, 201, reg.text);
  const id = reg.json.user.id;
  db.prepare(`INSERT INTO games (user_id, user_color, ai_elo, status, result, user_score, elo_before, fen, finished_at) VALUES (?, 'white', 1000, 'finished', '1-0', 1, 1000, 'x', ?)`).run(id, new Date().toISOString());
  assert.equal((await c('POST', '/api/profile/delete', { password: 'faux' })).status, 400);
  assert.equal((await c('POST', '/api/profile/delete', { password: 'motdepasse1' })).status, 200);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert.ok(u.deleted_at); assert.equal(u.email, `supprime-${id}@invalide.local`); assert.notEqual(u.username, 'suppr');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM games WHERE user_id = ?').get(id).n, 1);
  assert.equal((await c('GET', '/api/auth/me')).json.user, null);
  assert.equal((await c('GET', '/api/profile')).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { email: 'sup@t.l', password: 'motdepasse1' })).status, 401);
  // l'adresse redevient disponible
  assert.equal((await c('POST', '/api/auth/register', { email: 'sup@t.l', username: 'suppr', password: 'motdepasse1' })).status, 201);
});

test('réinitialisation : lien journalisé sans SMTP, e-mail envoyé avec un transport factice', async () => {
  const c = client();
  await c('POST', '/api/auth/register', { email: 'mail@t.l', username: 'mailer', password: 'motdepasse1' });
  const r1 = await c('POST', '/api/auth/forgot', { email: 'mail@t.l' });
  assert.equal(r1.status, 200); assert.match(r1.json.devLink, /https:\/\/exemple\.test\/#\/reset\/[a-f0-9]{64}/);
  const mail = await import('../server/services/mail.js');
  const m = mail.resetPasswordMail('https://exemple.test/#/reset/abc');
  assert.match(m.text, /https:\/\/exemple\.test\/#\/reset\/abc/); assert.match(m.html, /href="https:\/\/exemple\.test\/#\/reset\/abc"/);
  assert.equal(mail.mailEnabled(), false);
  assert.deepEqual(await mail.sendMail({ to: 'x', subject: 's', text: 't' }), { sent: false });
});

test('journal : ajout, validation, modification, suppression logique, cloisonnement ; export CSV', async () => {
  const c = client();
  await c('POST', '/api/auth/register', { email: 'jour@t.l', username: 'journal', password: 'motdepasse1' });
  assert.equal((await c('POST', '/api/journal', { kind: 'book', title: '', happened_on: '2026-11-01' })).status, 400);
  assert.equal((await c('POST', '/api/journal', { kind: 'book', title: 'x', happened_on: '2099-01-01' })).status, 400);
  assert.equal((await c('POST', '/api/journal', { kind: 'rating', title: 'chess.com', happened_on: '2026-11-01', rating: 50 })).status, 400);
  const a = await c('POST', '/api/journal', { kind: 'lesson', title: 'Cours club', minutes: 90, happened_on: '2026-11-01', note: 'finales de tours' });
  assert.equal(a.status, 201); assert.equal(a.json.entry.minutes, 90);
  const r = await c('POST', '/api/journal', { kind: 'rating', title: 'Elo chess.com', rating: 1150, platform: 'chess.com', happened_on: '2026-11-02' });
  assert.equal(r.status, 201); assert.equal(r.json.entry.rating, 1150); assert.equal(r.json.entry.minutes, null);
  const up = await c('PATCH', `/api/journal/${a.json.entry.id}`, { minutes: 120 });
  assert.equal(up.status, 200); assert.equal(up.json.entry.minutes, 120); assert.equal(up.json.entry.title, 'Cours club');
  const list = await c('GET', '/api/journal');
  assert.equal(list.json.entries.length, 2);
  assert.equal(list.json.totals.find(t => t.kind === 'lesson').minutes, 120);
  const prog = await c('GET', '/api/stats/progression?period=all');
  assert.equal(prog.json.journal.activities.length, 1);
  assert.equal(prog.json.journal.ratings[0].rating, 1150);
  const csvJ = await c('GET', '/api/export/journal');
  assert.match(csvJ.type, /text\/csv/); assert.match(csvJ.text, /Cours club;120/); assert.match(csvJ.text, /finales de tours/);
  for (const name of ['parties', 'elo', 'erreurs', 'exercices', 'faiblesses']) assert.equal((await c('GET', `/api/export/${name}`)).status, 200, name);
  assert.equal((await c('GET', '/api/export/inconnu')).status, 404);
  assert.equal((await c('DELETE', `/api/journal/${a.json.entry.id}`)).status, 200);
  assert.equal((await c('GET', '/api/journal')).json.entries.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM training_log WHERE deleted_at IS NOT NULL').get().n, 1); // jamais effacé
  // un autre compte ne voit rien et ne peut rien supprimer
  const o = client();
  await o('POST', '/api/auth/register', { email: 'autre@t.l', username: 'autrej', password: 'motdepasse1' });
  assert.equal((await o('GET', '/api/journal')).json.entries.length, 0);
  assert.equal((await o('DELETE', `/api/journal/${r.json.entry.id}`)).status, 404);
});
