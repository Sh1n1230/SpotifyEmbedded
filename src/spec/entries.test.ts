/** 実行環境ごとのエントリ（src/worker.ts・src/index.ts）。方針は ./support.ts の冒頭を参照。 */
import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../worker.js';
import {
  TSX_LOADER,
  callsTo,
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

    // IPv6 はアドレスを変えるだけで上限を超えられないよう /64 で数える
    allow = true;
    await worker.fetch(
      new Request('https://spotify-embedded.example/api/now-playing', {
        headers: { 'cf-connecting-ip': '2001:db8:1:2:ffff::9' },
      }),
      env,
      ctx
    );
    expect(limitedKeys.at(-1)).toBe('2001:db8:1:2::/64');
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

describe('Node のエントリは、作業ディレクトリに関係なく public/ を配る', () => {
  it('リポジトリの外から起動しても /embed.js とデモ画面（/）が返る', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'spotify-embedded-serve-'));
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [
        '--import',
        TSX_LOADER,
        fileURLToPath(new URL('../index.ts', import.meta.url)),
      ],
      {
        cwd,
        env: {
          PATH: process.env['PATH'] ?? '',
          PORT: String(port),
          SPOTIFY_CLIENT_ID: 'test-client-id',
          SPOTIFY_CLIENT_SECRET: 'test-client-secret',
          SPOTIFY_REFRESH_TOKEN: 'test-refresh-token',
        },
      }
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('running on')) resolve();
        });
        child.once('exit', () => reject(new Error('server exited before starting')));
      });

      // support.ts が fetch をモックしているので、実サーバーへは node:http で行く
      const embedStatus = await getStatus(`http://127.0.0.1:${port}/embed.js`);
      const demoStatus = await getStatus(`http://127.0.0.1:${port}/`);

      expect(embedStatus).toBe(200);
      expect(demoStatus).toBe(200);
    } finally {
      // Windows は作業ディレクトリを開いたままのプロセスを消せないので、終了を待つ
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});

function getStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe('Node のエントリの終了', () => {
  it.skipIf(process.platform === 'win32')('SIGTERM を受けたら、終了コード 0 で終わる（docker stop を待たせない）', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'spotify-embedded-signal-'));
    const port = await freePort();
    const child = spawn(process.execPath, ['--import', TSX_LOADER, fileURLToPath(new URL('../index.ts', import.meta.url))], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        PORT: String(port),
        SPOTIFY_CLIENT_ID: 'id',
        SPOTIFY_CLIENT_SECRET: 'secret',
        SPOTIFY_REFRESH_TOKEN: 'token',
      },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('running on')) resolve();
        });
        child.once('exit', () => reject(new Error('server exited before starting')));
      });
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));

      child.kill('SIGTERM');

      await expect(exited).resolves.toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('Workers のエントリは、バインディングが無くても動く（フォークや一部だけの wrangler dev）', () => {
  // app は最初のリクエストで一度だけ組み立てる（バインディングは isolate の中で変わらない前提）ので、読み直す
  async function freshWorker() {
    vi.resetModules();
    return (await import('../worker.js')).default;
  }
  const env = {} as Parameters<typeof worker.fetch>[1];
  const ctx = {} as Parameters<typeof worker.fetch>[2];
  const request = () => new Request('https://spotify-embedded.example/api/now-playing');

  it('MOODS も RATE_LIMITER も無くても、ムード文つきで 200 を返す', async () => {
    givenLlmConfigured();
    givenLlmReplies('今チルな気分になっています');
    givenNowPlaying(aSpotifyTrack());

    const res = await (await freshWorker()).fetch(request(), env, ctx);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { mood: { text: string } }).mood.text).toBe('今チルな気分になっています');
  });

  it('MOODS が無くても、2回目の同じ曲では LLM を呼ばない（メモリのキャッシュ）', async () => {
    givenLlmConfigured();
    givenLlmReplies('今チルな気分になっています');
    givenNowPlaying(aSpotifyTrack());
    const fresh = await freshWorker();

    await fresh.fetch(request(), env, ctx);
    await fresh.fetch(request(), env, ctx);

    expect(callsTo('/chat/completions')).toHaveLength(1);
  });

  it('RATE_LIMITER が無ければ 429 にせず、RateLimit-* も付けない', async () => {
    givenNowPlaying(aSpotifyTrack());
    const fresh = await freshWorker();

    for (let index = 0; index < 120; index += 1) {
      const res = await fresh.fetch(request(), env, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('RateLimit-Limit')).toBeNull();
    }
  });
});
