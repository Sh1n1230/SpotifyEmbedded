import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { formatResponseMiddleware } from './middleware/formatResponse.js';
import { errorHandler } from './middleware/errorHandler.js';
import nowPlayingRouter from './routes/nowPlaying.js';
import topTracksRouter from './routes/topTracks.js';
import statusRouter from './routes/status.js';
import authRouter from './routes/auth.js';

const app = express();

// セキュリティ: Express の技術スタック情報を隠す
app.disable('x-powered-by');

// セキュリティヘッダー
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
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

app.use('/api/now-playing', nowPlayingRouter);
app.use('/api/top-tracks', topTracksRouter);
app.use('/api/status', statusRouter);

if (config.server.enableAuthRoutes) {
  app.use('/auth', authRouter);
  console.log('⚠️  Auth routes enabled. Visit http://127.0.0.1:' + config.server.port + '/auth/login');
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(errorHandler);

app.listen(config.server.port, () => {
  console.log(`🎵 SpotifyEmbedded running on http://localhost:${config.server.port}`);
});
