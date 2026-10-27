/** 実行環境ごとのエントリ（src/worker.ts・src/index.ts）。方針は ./support.ts の冒頭を参照。 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../worker.js';
import {
  NOW_ISO,
  aSpotifyTrack,
  givenNowPlaying,
  givenLlmConfigured,
  givenLlmReplies,
} from './support.js';

describe('Workers のエントリ（src/worker.ts）は、バインディングを KV とレート制限に繋ぐ', () => {
  it('ムード文は期限付きで KV に書き、レート制限は接続元 IP ごとに数える', async () => {
    const puts: { key: string; value: string; options: unknown }[] = [];
    const moods = {
      get: () => Promise.resolve(null),
      put: (key: string, value: string, options: unknown) => {
        puts.push({ key, value, options });
        return Promise.resolve();
      },
    };
    let allow = true;
    const limitedKeys: string[] = [];
    const rateLimiter = {
      limit: ({ key }: { key: string }) => {
        limitedKeys.push(key);
        return Promise.resolve({ success: allow });
      },
    };
    const env = { MOODS: moods, RATE_LIMITER: rateLimiter } as unknown as Parameters<typeof worker.fetch>[1];
    const ctx = {} as Parameters<typeof worker.fetch>[2];
    const request = () =>
      new Request('https://spotify-embedded.example/api/now-playing', {
        headers: { 'cf-connecting-ip': '203.0.113.7' },
      });
    givenLlmConfigured();
    givenLlmReplies('今チルな気分になっています');
    givenNowPlaying(aSpotifyTrack());

    const ok = await worker.fetch(request(), env, ctx);

    expect(ok.status).toBe(200);
    expect(puts).toEqual([
      {
        key: 'mood:track-1',
        value: JSON.stringify({ text: '今チルな気分になっています', generated_at: NOW_ISO }),
        // KV の無料枠は書き込みが 1,000回/日。期限なしで溜め込まない
        options: { expirationTtl: 86400 },
      },
    ]);
    expect(limitedKeys).toEqual(['203.0.113.7']);

    allow = false;
    const limited = await worker.fetch(request(), env, ctx);

    expect(limited.status).toBe(429);
  });
});

describe('dotenv を読むのは Node のエントリだけ（Workers では使えない）', () => {
  it('src/index.ts と src/cli/index.ts 以外は dotenv を import しない', () => {
    const srcDir = fileURLToPath(new URL('..', import.meta.url));
    const importers = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => /from ['"]dotenv|import ['"]dotenv/.test(readFileSync(join(srcDir, file), 'utf8')))
      .map((file) => file.split('\\').join('/'))
      .sort();

    expect(importers).toEqual(['cli/index.ts', 'index.ts']);
  });
});
