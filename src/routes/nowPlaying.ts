import { Hono } from 'hono';
import { collectNowPlaying } from '../core/collect.js';
import { sendFormatted } from '../http/respond.js';

const router = new Hono();

router.get('/', async (c) => sendFormatted(c, await collectNowPlaying()));

export default router;
