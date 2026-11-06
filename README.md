# Chess Coach IA

Plateforme d'échecs en ligne avec IA adaptative simulant un joueur humain, Elo évolutif,
analyse des parties et entraînement personnalisé.

## Démarrer

```bash
npm install
npm start          # http://localhost:3000
npm test           # tests automatiques
```

Variables d'environnement (toutes optionnelles) :

| Variable         | Rôle                                            | Défaut                  |
|------------------|-------------------------------------------------|-------------------------|
| `PORT`           | Port HTTP                                       | `3000`                  |
| `NODE_ENV`       | `production` active les cookies sécurisés (HTTPS) | —                     |
| `SESSION_SECRET` | Secret de signature des sessions                | généré dans `data/`     |
| `DATA_DIR`       | Dossier de la base SQLite                       | `./data`                |
| `BASE_URL`       | Adresse publique du site (liens dans les e-mails) | `http://localhost:3000` |
| `TRUST_PROXY`    | À définir (`1`) derrière un reverse proxy       | —                       |
| `ENGINE_POOL`    | Nombre de processus Stockfish                   | `2`                     |
| `ADMIN_EMAILS`   | Adresses (séparées par des virgules) ayant accès aux statistiques d'usage | — |
| `SMTP_URL`       | Serveur d'envoi des e-mails (`smtps://login:cle@smtp-relay.brevo.com:465`) ; absent = lien journalisé | — |
| `MAIL_FROM`      | Expéditeur des e-mails                          | —                       |
| `ANALYSIS_DEPTH` | Profondeur Stockfish pour l'analyse des parties | `14`                    |
| `LITESTREAM_REPLICA_URL` | Sauvegarde continue de la base (S3/Backblaze), voir Déploiement | — |

## Architecture

```
server/
  index.js          serveur Express, sessions, fichiers statiques
  db.js             SQLite (better-sqlite3) + exécution des migrations
  migrations/       schéma, migrations ADDITIVES uniquement (jamais de DROP)
  middleware.js     requireAuth, publicUser
  routes/           auth, profile, games, training, stats, admin
  services/         elo, games, analysis (évaluation des coups), puzzles (vérification des exercices), training (sélection, SRS, faiblesses), stats (agrégations progression/statistiques)
  puzzles/          library.json : bibliothèque d'exercices vérifiés par Stockfish
  engine/           stockfish (pool de processus UCI), ai (choix de coup par niveau Elo)
public/
  index.html        coquille de l'application monopage
  css/app.css       jetons de design, composants, pages
  js/app.js         état d'authentification, routeur (#/…), navigation
  js/api.js         client HTTP
  js/ui.js          gabarits HTML sûrs, toasts, formats
  js/board.js       échiquier interactif (cm-chessboard + chess.js)
  js/pages/*.js     une page = un module avec render(main, params)
tests/              node --test : Elo, flux de partie, pendule, cloisonnement
data/               base SQLite et secret de session (non versionnés)
```

### Choix techniques

- **Node.js + Express** : un seul langage côté serveur et navigateur.
- **SQLite** : zéro configuration, un fichier ; l'accès est isolé dans `server/` pour
  permettre un passage à PostgreSQL. Les migrations ne suppriment jamais de données.
- **chess.js** : règles officielles complètes (roque, prise en passant, promotion,
  répétition, 50 coups, mat, pat).
- **Stockfish (WebAssembly)** côté serveur : analyse et génération des coups de l'IA.
- **Frontend sans framework** : modules ES natifs, aucune étape de compilation ;
  échiquier `cm-chessboard`, graphiques `Chart.js`.

## Calibration de l'IA

Deux calibrations complémentaires (dernière : 6 nov. 2026).

**Absolue** — `node scripts/calibrate-abs.mjs <elo> [parties] [maxPlies]` : l'IA joue contre elle-même, chaque
coup est évalué comme dans l'analyse du site, et l'on compare la précision (méthode Lichess : moyenne
harmonique + pondération par la volatilité) aux moyennes publiées par niveau chess.com
(Kaufman, 2023, parties 10+0 ≈ Elo/100 + 64).

| Niveau | Précision mesurée | Référence chess.com | Perte moy. | Gaffes / partie |
|--------|-------------------|---------------------|-----------|-----------------|
| 400    | 65 %              | 69 %                | 104 cp    | 3,4             |
| 1000   | 73 %              | 76 %                | 92 cp     | 1,7             |
| 1600   | 80 %              | 81 %                | 65 cp     | 0,3             |
| 2200   | 87 %              | 86 %                | 35 cp     | 0,2             |

**Relative** — `node scripts/calibrate.mjs <eloA> <eloB> [parties]` : à 200 Elo d'écart, le plus faible doit
marquer ≈ 24 %. Mesuré : 800/1000 → 25 %, 1400/1600 → 31 %, 1800/2000 → 13 % (16 parties chacun, ± 11 %).

Garde-fous vérifiés par `node scripts/endgame-check.mjs` : l'IA mate avec dame ou tour à tous les niveaux,
reprend toujours une pièce qui vient de prendre, évite la répétition en position gagnante.

Leviers (dans `server/engine/ai.js`, `paramsForElo`) : profondeur fractionnaire (2 → 7,8), température du
softmax (300 → 52 cp), taux de gaffes plausibles (23 % → 1,5 %), mats en 1 et prises gratuites manqués.
Les échelles des plateformes diffèrent entre elles ; l'alignement vise chess.com (rapide).

## Bibliothèque d'exercices

`node scripts/build-library.mjs [cible]` génère des parties IA contre IA, repère les positions tactiques et
les vérifie à profondeur 16 (solution unique, gain net ou mat complet). `REVERIFY=1` repasse les exercices
existants avec les règles courantes. Les exercices personnels (tirés des parties du joueur) suivent la même
vérification, après chaque analyse.

## Déploiement

Le dépôt contient un `Dockerfile` et un `render.yaml` (Render, plan gratuit, région Francfort). La base SQLite
vit sur le disque du conteneur ; comme ce disque est effacé à chaque redémarrage sur le plan gratuit,
`scripts/start.sh` utilise **Litestream** : au démarrage la base est restaurée depuis la sauvegarde
(Backblaze B2, compatible S3), puis chaque écriture est répliquée en continu (délai ≈ 1 s).

Variables à définir chez l'hébergeur : `BASE_URL`, `SESSION_SECRET`, `ADMIN_EMAILS`, `LITESTREAM_REPLICA_URL`
(`s3://NOM-DU-BUCKET.s3.eu-central-003.backblazeb2.com/chess-coach`), `LITESTREAM_ACCESS_KEY_ID`,
`LITESTREAM_SECRET_ACCESS_KEY`, `SMTP_URL`, `MAIL_FROM`. Santé : `GET /healthz`.

Référencement : `robots.txt`, `sitemap.xml`, balises canonical/Open Graph et contenu de la page d'accueil
servis avec `BASE_URL` ; page `#/confidentialite` ; suppression de compte par anonymisation (`POST /api/profile/delete`).

## Avancement

- [x] Phase 1a — comptes, sessions, profil, paramètres, coquille de l'application
- [x] Phase 1b — échiquier, parties contre l'IA, pendule, sauvegarde, Elo, historique, replay
- [x] Phase 2 — IA adaptative « humaine » (erreurs plausibles, personnalité, ouverture, calibration)
- [x] Phase 3 — analyse des parties (Stockfish, rapport, replay annoté, motifs d'erreur)
- [x] Phase 4 — entraînement (bibliothèque vérifiée, exercices personnels, répétition espacée, faiblesses, programme du jour)
- [x] Phase 5 — progression (courbe Elo, précision, faiblesses, thèmes, activité) et statistiques (résultats, comparaisons, erreurs, exercices)
- [x] Phase 5b — journal d'entraînement (activités hors site, Elo externes, affichés sur les courbes) et export CSV
- [ ] Phase 6 — mise en ligne (hébergement, e-mails, domaine, référencement) : en cours (Render + GitHub faits, sauvegarde Backblaze à configurer)
