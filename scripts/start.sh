#!/bin/sh
# Démarrage en production. Si LITESTREAM_REPLICA_URL est défini (ex. s3://bucket.s3.eu-central-003.backblazeb2.com/chess-coach),
# la base est restaurée depuis la sauvegarde au démarrage (quand le disque est vide), puis répliquée en continu.
set -e
DATA_DIR="${DATA_DIR:-/data}"
DB="${DB_PATH:-$DATA_DIR/chess-coach.sqlite}"
mkdir -p "$DATA_DIR"
if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  echo "[start] restauration de la base depuis la sauvegarde si nécessaire…"
  litestream restore -if-db-not-exists -if-replica-exists -o "$DB" "$LITESTREAM_REPLICA_URL"
  echo "[start] réplication continue activée"
  exec litestream replicate -exec "node server/index.js" "$DB" "$LITESTREAM_REPLICA_URL"
else
  echo "[start] AVERTISSEMENT : pas de LITESTREAM_REPLICA_URL, la base n'est pas sauvegardée hors du disque"
  exec node server/index.js
fi
