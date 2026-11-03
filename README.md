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

`node scripts/calibrate.mjs <eloA> <eloB> [parties]` fait jouer deux niveaux l'un contre l'autre.
Objectif : à 200 Elo d'écart, le plus faible marque environ 24 %. Dernière calibration (2 nov. 2026) :

| Palier      | Parties | Score du plus faible |
|-------------|---------|----------------------|
| 600 / 800   | 32      | 22 %                 |
| 800 / 1000  | 32      | 25 %                 |
| 1200 / 1400 | 48      | 20 %                 |
| 1600 / 1800 | 24      | 25 %                 |
| 1400 / 1600 | 24      | 19 %                 |
| 1800 / 2000 | 24      | 29 %                 |

Garde-fous vérifiés par `node scripts/endgame-check.mjs` : l'IA mate avec dame ou tour à tous les niveaux,
reprend toujours une pièce qui vient de prendre, évite la répétition en position gagnante.

Leviers (dans `server/engine/ai.js`, `paramsForElo`) : profondeur fractionnaire (3 → 6,2),
température du softmax (240 → 60 cp), taux de gaffes plausibles (17 % → 2,5 %), mats en 1 et
prises gratuites manqués. La profondeur est un levier très brutal : elle reste à 3 jusqu'à 1000 Elo.

## Bibliothèque d'exercices

`node scripts/build-library.mjs [cible]` génère des parties IA contre IA, repère les positions tactiques et
les vérifie à profondeur 16 (solution unique, gain net ou mat complet). `REVERIFY=1` repasse les exercices
existants avec les règles courantes. Les exercices personnels (tirés des parties du joueur) suivent la même
vérification, après chaque analyse.

## Avancement

- [x] Phase 1a — comptes, sessions, profil, paramètres, coquille de l'application
- [x] Phase 1b — échiquier, parties contre l'IA, pendule, sauvegarde, Elo, historique, replay
- [x] Phase 2 — IA adaptative « humaine » (erreurs plausibles, personnalité, ouverture, calibration)
- [x] Phase 3 — analyse des parties (Stockfish, rapport, replay annoté, motifs d'erreur)
- [x] Phase 4 — entraînement (bibliothèque vérifiée, exercices personnels, répétition espacée, faiblesses, programme du jour)
- [x] Phase 5 — progression (courbe Elo, précision, faiblesses, thèmes, activité) et statistiques (résultats, comparaisons, erreurs, exercices)
- [ ] Phase 6 — mise en ligne (hébergement, e-mails, domaine, référencement)
