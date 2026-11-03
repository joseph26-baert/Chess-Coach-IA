# Image de production : Node 22 + Litestream (sauvegarde continue de la base SQLite vers un stockage S3)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && npm ci --omit=dev \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Certificats racine : indispensables à Litestream pour la connexion HTTPS vers le stockage de sauvegarde
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=litestream/litestream:0.3.13 /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts/start.sh ./scripts/start.sh
RUN chmod +x scripts/start.sh && mkdir -p /data
ENV DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["./scripts/start.sh"]
