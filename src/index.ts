import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { missingAuthValues } from './authStore.js';
import { formatResponseMiddleware } from './middleware/formatResponse.js';
import { errorHandler } from './middleware/errorHandler.js';
import nowPlayingRouter from './routes/nowPlaying.js';
import topTracksRouter from './routes/topTracks.js';
import statusRouter from './routes/status.js';
import authRouter from './routes/auth.js';
import embedRouter from './routes/embed.js';

const app = express();

// セキュリティ: Express の技術スタック情報を隠す
app.disable('x-powered-by');

// セキュリティヘッダー
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // /embed は他サイトの iframe に埋め込んでもらうためのページなので、
  // ここだけフレーム禁止を外す。API・デモ画面は DENY のまま。
  if (req.path !== '/embed') {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(cors({ origin: config.server.corsOrigin }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  })
);

app.use(formatResponseMiddleware);

// デモフロントエンド + ワンタグ埋め込み用の embed.js
app.use(express.static('public'));

app.use('/api/now-playing', nowPlayingRouter);
app.use('/api/top-tracks', topTracksRouter);
app.use('/api/status', statusRouter);

// /embed, /badge.svg, /ranking.svg
app.use('/', embedRouter);

if (config.server.enableAuthRoutes) {
  app.use('/auth', authRouter);
  console.log('⚠️  Auth routes enabled. Visit http://127.0.0.1:' + config.server.port + '/auth/login');
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(errorHandler);

// 設定漏れは起動時に気づけるようにする（値の解決自体は遅延評価）
const missing = missingAuthValues();
if (missing.length > 0) {
  console.error(`\n⚠️  設定が見つかりません: ${missing.join(', ')}`);
  console.error('   `npx spotify-embedded setup` で対話的に設定できます。\n');
  // 認証ルート有効時は refresh_token を取りに来ている途中なので起動を続ける
  if (!config.server.enableAuthRoutes) process.exit(1);
}

app.listen(config.server.port, () => {
  console.log(`🎵 SpotifyEmbedded running on http://localhost:${config.server.port}`);
});
