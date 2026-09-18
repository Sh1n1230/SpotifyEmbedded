import { Router } from 'express';
import { collectTopTracks } from '../core/collect.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    res.sendFormatted(await collectTopTracks());
  } catch (err) {
    next(err);
  }
});

export default router;
