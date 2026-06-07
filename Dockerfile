# Fly.io / Google Cloud Run / VPS など、Docker が動く環境ならどこでも使えます。
# 秘密情報は COPY しません（.dockerignore で .env を除外）。実行時に
# 環境変数として渡してください（例: fly secrets set / docker run -e ...）。

# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
