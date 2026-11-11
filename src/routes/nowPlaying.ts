import { Hono } from 'hono';
import { collectNowPlaying } from '../core/collect.js';
import { sendFormatted } from '../http/respond.js';
import { liveMoodOptions } from '../http/background.js';

const router = new Hono();

router.get('/', async (c) => sendFormatted(c, await collectNowPlaying(liveMoodOptions(c))));

export default router;
