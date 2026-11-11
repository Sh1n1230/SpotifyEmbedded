# syntax=docker/dockerfile:1
# Fly.io / Google Cloud Run / VPS など、Docker が動く環境ならどこでも使えます。
# 秘密情報は COPY しません（.dockerignore で .env を除外）。実行時に
# 環境変数として渡してください（例: fly secrets set / docker run --env-file）。

# ベースイメージは digest で固定する（タグは中身が差し替わるため）。
# 更新は Dependabot（.github/dependabot.yml の docker）が PR にする。

# --- build stage ---
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package*.json ./
# npm のキャッシュは層の外（BuildKit のキャッシュマウント）に置く。package-lock.json が変わって層が無効になっても、
# 変わっていないパッケージをダウンロードし直さない。キャッシュはイメージに入らない
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# --- runtime stage ---
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
# 版はビルドのときに --build-arg VERSION=1.2.3 で渡せる（渡さなくてもビルドできる）
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/Sh1n1230/SpotifyEmbedded" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="Spotify の再生状況を AI のムード文つきで埋め込むライブAPI" \
      org.opencontainers.image.version="${VERSION}"
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY public ./public
USER node
EXPOSE 3000
# 30秒ごとに走るので、Node を起動しない（数十 MB のメモリと数百 ms の CPU を使う）。ベースイメージの busybox の wget で足りる。
# PORT を展開するためシェル形式で書く。127.0.0.1 と書くのは、localhost が IPv6（::1）に解決されて届かないことがあるため
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health" || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
