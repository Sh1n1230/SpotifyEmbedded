/** 設定の解決（環境変数 → data/auth.json）と setup による保存。方針は ./support.ts の冒頭を参照。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadStoredAuth, saveStoredAuth } from '../authStore.js';
import { collectNowPlaying } from '../core/collect.js';
import { upsertEnvFile } from '../cli/setup.js';
import type { SpotifyTrack } from '../types/index.js';
import {
  NOW,
  respondWith,
  jsonOk,
  callsTo,
  headerOf,
  aSpotifyTrack,
  givenNowPlaying,
  givenLlmReplies,
} from './support.js';

describe('設定は「環境変数 → data/auth.json」の順に解決し、.env だけで動いている構成を変えない', () => {
  let dir: string;
  let storePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spotify-embedded-auth-'));
    storePath = join(dir, 'auth.json');
    vi.stubEnv('AUTH_STORE_PATH', storePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function givenAuthFile(content: Record<string, unknown>): void {
    writeFileSync(storePath, JSON.stringify(content));
    loadStoredAuth(true);
  }

  /** トークンはモジュール内にキャッシュされるので、API の 401 で取り直しを起こす */
  function givenTokenRefreshForced(track: SpotifyTrack | null): void {
    let attempt = 0;
    respondWith((url) => {
      if (!url.includes('/me/player/currently-playing')) return null;
      attempt += 1;
      if (attempt === 1) return new Response('expired', { status: 401 });
      if (!track) return new Response(null, { status: 204 });
      return jsonOk({ is_playing: true, progress_ms: 1000, item: track, timestamp: NOW.getTime() });
    });
  }

  function refreshTokenSent(): string | null {
    const body = callsTo('accounts.spotify.com/api/token').at(-1)?.init?.body;
    return body instanceof URLSearchParams ? body.get('refresh_token') : null;
  }

  it('環境変数があれば、data/auth.json の値より優先する', async () => {
    givenAuthFile({ spotifyRefreshToken: 'from-file' });
    givenTokenRefreshForced(null);

    await collectNowPlaying();

    expect(refreshTokenSent()).toBe('spec-refresh-token');
  });

  it('環境変数が無い項目は data/auth.json から補う', async () => {
    vi.stubEnv('SPOTIFY_REFRESH_TOKEN', '');
    givenAuthFile({ spotifyRefreshToken: 'from-file' });
    givenTokenRefreshForced(null);

    await collectNowPlaying();

    expect(refreshTokenSent()).toBe('from-file');
  });

  it('壊れた data/auth.json は無視し、環境変数だけで動く', async () => {
    writeFileSync(storePath, '{ not json');
    loadStoredAuth(true);
    givenTokenRefreshForced(aSpotifyTrack());

    const result = await collectNowPlaying();

    expect(result.track?.id).toBe('track-1');
    expect(refreshTokenSent()).toBe('spec-refresh-token');
  });

  describe('LLM の APIキー', () => {
    beforeEach(() => {
      vi.stubEnv('LLM_BASE_URL', 'https://api.groq.com/openai/v1');
      givenLlmReplies('今チルな気分になっています');
      givenNowPlaying(aSpotifyTrack());
    });

    function llmKeySent(): string | undefined {
      const call = callsTo('/chat/completions')[0];
      return call ? headerOf(call, 'Authorization') : undefined;
    }

    it.each(['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'])(
      'よくある名前の %s に入っていても、そのまま拾う',
      async (name) => {
        vi.stubEnv(name, 'alias-key');

        await collectNowPlaying();

        expect(llmKeySent()).toBe('Bearer alias-key');
      }
    );

    it('LLM_API_KEY があれば、別名より優先する', async () => {
      vi.stubEnv('GROQ_API_KEY', 'alias-key');
      vi.stubEnv('LLM_API_KEY', 'canonical-key');

      await collectNowPlaying();

      expect(llmKeySent()).toBe('Bearer canonical-key');
    });

    it('旧バージョンの data/auth.json（groqApiKey）もそのまま読める', async () => {
      givenAuthFile({ groqApiKey: 'legacy-key' });

      await collectNowPlaying();

      expect(llmKeySent()).toBe('Bearer legacy-key');
    });
  });

  describe('npm run setup による保存', () => {
    it('既存の内容に上書きでマージする', () => {
      givenAuthFile({ spotifyClientId: 'kept', spotifyRefreshToken: 'old' });

      saveStoredAuth({ spotifyRefreshToken: 'new' });

      expect(JSON.parse(readFileSync(storePath, 'utf8'))).toEqual({
        spotifyClientId: 'kept',
        spotifyRefreshToken: 'new',
      });
    });

    it.skipIf(process.platform === 'win32')(
      '秘密情報を含むので、既存のファイルでも本人だけが読める権限（0600）にする',
      () => {
        writeFileSync(storePath, '{}', { mode: 0o644 });

        saveStoredAuth({ spotifyRefreshToken: 'secret' });

        expect(statSync(storePath).mode & 0o777).toBe(0o600);
      }
    );

    describe('設定ファイル（.env）の書き換え', () => {
      let envPath: string;
      beforeEach(() => {
        envPath = join(mkdtempSync(join(tmpdir(), 'spotify-embedded-spec-envfile-')), 'env');
      });

      it('LLM を外すと、別名で書かれたキーの行も消す（残すと別名から読まれて有効なままになる）', () => {
        writeFileSync(envPath, '# メモ\nSPOTIFY_CLIENT_ID=id\nGROQ_API_KEY=old\nGROQ_MODEL=m\n');

        const removed = upsertEnvFile(envPath, { llmApiKey: '', llmBaseUrl: '', llmModel: '' });

        expect(readFileSync(envPath, 'utf8')).toBe('# メモ\nSPOTIFY_CLIENT_ID=id\n');
        expect(removed).toEqual(['GROQ_API_KEY', 'GROQ_MODEL']);
      });

      it.each([
        ['改行', 'new\nLLM_BASE_URL=https://evil.example'],
        ['CR', 'new\rX=1'],
        ['制御文字', 'new\u0000'],
      ])('%s を含む値は書き込まない（別の行を差し込めてしまう）', (_, value) => {
        writeFileSync(envPath, '# メモ\nLLM_API_KEY=old\n');

        expect(() => upsertEnvFile(envPath, { llmApiKey: value })).toThrow(/LLM_API_KEY/);
        expect(readFileSync(envPath, 'utf8')).toBe('# メモ\nLLM_API_KEY=old\n');
      });

      it('値の差し替えは正規名の行だけを書き換え、他の行は触らない', () => {
        writeFileSync(envPath, '# メモ\nLLM_API_KEY=old\nOTHER=x\n');

        upsertEnvFile(envPath, { llmApiKey: 'new' });

        expect(readFileSync(envPath, 'utf8')).toBe('# メモ\nLLM_API_KEY=new\nOTHER=x\n');
      });

      it.skipIf(process.platform === 'win32')('既存のファイルでも本人だけが読める権限（0600）にする', () => {
        writeFileSync(envPath, '', { mode: 0o644 });

        upsertEnvFile(envPath, { spotifyRefreshToken: 'secret' });

        expect(statSync(envPath).mode & 0o777).toBe(0o600);
      });
    });
  });
});

describe('秘密情報を書いたファイルは、git にも Docker イメージにも入らない', () => {
  function patterns(file: string): string[] {
    return readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
  }

  it('.gitignore は .env* と .dev.vars*（環境ごとの派生ファイルも）を除き、例のファイルだけ戻す', () => {
    const ignore = patterns('.gitignore');

    expect(ignore).toEqual(expect.arrayContaining(['.env*', '!.env.example', '.dev.vars*', '!.dev.vars.example']));
    expect(ignore).toContain('data/');
  });

  it('.dockerignore も同じ範囲を除く', () => {
    const ignore = patterns('.dockerignore');

    expect(ignore).toEqual(expect.arrayContaining(['.env', '.env.*', '!.env.example', '.dev.vars*', 'data']));
  });
});
