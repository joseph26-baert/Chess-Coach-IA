# Chess Coach

Plateforme d'échecs en ligne avec IA adaptative simulant un joueur humain, Elo évolutif,
analyse des parties et entraînement personnalisé.

## Démarrer

```bash
npm install
npm start          # http://localhost:3000
```

Variables d'environnement (toutes optionnelles) :

| Variable         | Rôle                                            | Défaut                  |
|------------------|-------------------------------------------------|-------------------------|
| `PORT`           | Port HTTP                                       | `3000`                  |
| `NODE_ENV`       | `production` active les cookies sécurisés (HTTPS) | —                     |
| `SESSION_SECRET` | Secret de signature des sessions                | généré dans `data/`     |
| `DATA_DIR`       | Dossier de la base SQLite                       | `./data`                |

## Architecture

```
server/
  index.js          serveur Express, sessions, fichiers statiques
  db.js             SQLite (better-sqlite3) + exécution des migrations
  migrations/       schéma, migrations ADDITIVES uniquement (jamais de DROP)
  middleware.js     requireAuth, publicUser
  routes/           auth, profile, (games, analysis, training… à venir)
public/
  index.html        coquille de l'application monopage
  css/app.css       jetons de design, composants, pages
  js/app.js         état d'authentification, routeur (#/…), navigation
  js/api.js         client HTTP
  js/ui.js          gabarits HTML sûrs, toasts, formats
  js/pages/*.js     une page = un module avec render(main, params)
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
- [ ] Phase 1b — échiquier, parties contre l'IA, sauvegarde, Elo, historique
- [ ] Phase 2 — IA adaptative « humaine »
- [ ] Phase 3 — analyse des parties
- [ ] Phase 4 — entraînement et détection des faiblesses
- [ ] Phase 5 — graphiques, statistiques, programme personnalisé
