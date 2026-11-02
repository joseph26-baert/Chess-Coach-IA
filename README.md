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

## Architecture

```
server/
  index.js          serveur Express, sessions, fichiers statiques
  db.js             SQLite (better-sqlite3) + exécution des migrations
  migrations/       schéma, migrations ADDITIVES uniquement (jamais de DROP)
  middleware.js     requireAuth, publicUser
  routes/           auth, profile, games
  services/         elo (formule documentée), games (coups, fin de partie, pendule)
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

## Avancement

- [x] Phase 1a — comptes, sessions, profil, paramètres, coquille de l'application
- [x] Phase 1b — échiquier, parties contre l'IA, pendule, sauvegarde, Elo, historique, replay
- [ ] Phase 2 — IA adaptative « humaine »
- [ ] Phase 3 — analyse des parties
- [ ] Phase 4 — entraînement et détection des faiblesses
- [ ] Phase 5 — graphiques, statistiques, programme personnalisé
