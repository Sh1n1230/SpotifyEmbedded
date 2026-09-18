import { Router } from 'express';
import { collectStatus } from '../core/collect.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    res.sendFormatted(await collectStatus());
  } catch (err) {
    next(err);
  }
});

export default router;
