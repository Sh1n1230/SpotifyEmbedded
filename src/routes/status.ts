import { Router } from 'express';
import { collectStatus } from '../core/collect.js';
import { parseRange, parseLimit } from '../core/topTracksParams.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.sendFormatted(
      await collectStatus({
        range: parseRange(req.query['range']),
        limit: parseLimit(req.query['limit']),
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;
