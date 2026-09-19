import { Router } from 'express';
import { collectNowPlaying } from '../core/collect.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    res.sendFormatted(await collectNowPlaying());
  } catch (err) {
    next(err);
  }
});

export default router;
