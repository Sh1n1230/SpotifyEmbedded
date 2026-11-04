/** CLI（spotify-embedded）の起動と引数の検証。方針は ./support.ts の冒頭を参照。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { get } from 'node:http';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  askCustomBaseUrl,
  browserCommand,
  currentRepo,
  deleteGitHubSecret,
  invalidInputReason,
  refreshTokenRenewalDate,
  runOAuthFlow,
  setGitHubSecret,
  setupRedirectUriProblem,
  type GhRunner,
} from '../cli/setup.js';
import { jsonOk, respondWith } from './support.js';

interface RunOptions {
  /** 標準入力に流す内容。流し終えると EOF になる。 */
  input?: string;
  env?: Record<string, string>;
  /** 作業ディレクトリに置くファイル（名前 → 中身）。 */
  files?: Record<string, string>;
  timeout?: number;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  cwd: string;
}

/**
 * src/ の TypeScript のエントリを実際のプロセスとして起動する。手元の設定を拾わないよう、
 * 空の作業ディレクトリと最小の環境変数で動かす。
 */
function runEntry(entry: string, args: string[], options: RunOptions, cwds: string[]): RunResult {
  const cwd = mkdtempSync(join(tmpdir(), 'spotify-embedded-cli-'));
  cwds.push(cwd);
  for (const [name, content] of Object.entries(options.files ?? {})) writeFileSync(join(cwd, name), content);
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
      fileURLToPath(new URL(entry, import.meta.url)),
      ...args,
    ],
    {
      cwd,
      env: { PATH: process.env['PATH'] ?? '', ...options.env },
      encoding: 'utf8',
      timeout: options.timeout ?? 20_000,
      input: options.input ?? '',
    }
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, cwd };
}

describe('CLI（spotify-embedded）', () => {
  const cwds: string[] = [];
  afterEach(() => {
    for (const dir of cwds.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function runCli(args: string[], options: RunOptions = {}): RunResult {
    return runEntry('../cli/index.ts', args, options, cwds);
  }

  it('設定が何も無くても、読み込みだけでは落ちない（npm run setup が動くために必要）', () => {
    const run = runCli(['help']);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('npm run setup');
  }, 30_000);

  describe('generate は Spotify が受け付けない指定を、取得を始める前に弾く', () => {
    it.each([
      [['--range', 'two_weeks'], '--range'],
      [['--limit', '20'], '--limit'],
      // 数字の後ろの余計な文字や小数を黙って切り捨てない
      [['--limit', '10abc'], '--limit'],
      [['--limit', '50.9'], '--limit'],
      [['--count', '5x'], '--count'],
      [['--count', '7.5'], '--count'],
      [['--count', '1e2'], '--count'],
      [['--count', '0'], '--count'],
      [['--count', '51'], '--count'],
      [['--theme', 'sepia'], '--theme'],
      [['--out'], '--out'],
      [['--verbose'], '--verbose'],
    ])('%j', (args, mentioned) => {
      const run = runCli(['generate', ...args]);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(mentioned);
      // 出力先（既定の ./out）すら作らない
      expect(readdirSync(run.cwd)).toEqual([]);
    }, 30_000);
  });

  it('--limit 30・--count 10 のような正しい整数は今までどおり受け付ける', () => {
    // 後ろの --theme で止めて、--limit と --count は通ったことを確かめる
    const run = runCli(['generate', '--limit', '30', '--count', '10', '--theme', 'sepia']);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('--theme');
    expect(run.stderr).not.toContain('--limit');
    expect(run.stderr).not.toContain('--count');
  }, 30_000);

  it('不明なコマンドは使い方を出して失敗する', () => {
    const run = runCli(['deploy']);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('不明なコマンド: deploy');
    expect(run.stderr).toContain('使い方');
  }, 30_000);
});

describe('npm run auth（/auth/* を有効にした Node のサーバー）', () => {
  const cwds: string[] = [];
  afterEach(() => {
    for (const dir of cwds.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('シェルの構文に頼らず有効にし、設定ファイルの ENABLE_AUTH_ROUTES=false より優先する', () => {
    // サーバーは止まらないので、時間切れで止める。refresh_token が無くても /auth を使うために起動は続く
    // （PORT=0 は受け付けないので、ほかと重ならない番号を使う）
    const run = runEntry(
      '../authServer.ts',
      [],
      {
        env: { PORT: String(40_000 + (process.pid % 20_000)), SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' },
        files: { '.env': 'ENABLE_AUTH_ROUTES=false\n' },
        timeout: 8_000,
      },
      cwds
    );

    expect(run.stdout).toContain('Auth routes enabled');
  }, 30_000);

  it('npm run setup は、入力が端末でなければ理由を示して終了コード 1 で終わる', () => {
    const run = runEntry('../cli/index.ts', ['setup'], { input: '', timeout: 8_000 }, cwds);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('端末');
  }, 30_000);

  it('npm run dev（src/index.ts）では /auth/* は無効のまま（設定が無ければ起動しない）', () => {
    const run = runEntry('../index.ts', [], { env: { PORT: String(40_001 + (process.pid % 20_000)) }, timeout: 8_000 }, cwds);

    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain('Auth routes enabled');
  }, 30_000);

  it('npm run auth でも Client ID / Secret が無ければ、/auth/login が動かないので起動しない', () => {
    const run = runEntry('../authServer.ts', [], { env: { PORT: String(40_002 + (process.pid % 20_000)) }, timeout: 8_000 }, cwds);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('SPOTIFY_CLIENT_ID');
  }, 30_000);

  it.each(['abc', '3000abc', '0', '70000'])('PORT=%s ならスタックトレースではなく直し方を出して終わる', (port) => {
    const run = runEntry('../index.ts', [], { env: { PORT: port }, timeout: 8_000 }, cwds);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`PORT は 1〜65535 の整数で指定してください（今の値: ${port}）`);
    expect(run.stderr).not.toMatch(/\n\s+at /);
  }, 30_000);
});

describe('npm run setup の LLM エンドポイントの入力（API キーの送り先）', () => {
  /** 決まった順に答える。聞かれた質問を記録する。 */
  function answers(...replies: string[]) {
    const asked: string[] = [];
    const prompt = (query: string) => {
      asked.push(query);
      return Promise.resolve(replies.shift() ?? '');
    };
    return { prompt, asked };
  }

  function printed(): string {
    return vi.mocked(console.log).mock.calls.flat().join('\n');
  }

  it('http のリモートの URL は、API キーを平文で送るのでその場で入力し直させる', async () => {
    const { prompt, asked } = answers('http://example.com/v1', 'https://api.openai.com/v1');

    await expect(askCustomBaseUrl(prompt)).resolves.toBe('https://api.openai.com/v1');
    expect(printed()).toContain('https の URL を指定してください');
    expect(asked.filter((q) => q.includes('エンドポイントURL'))).toHaveLength(2);
  });

  it('URL として読めない入力も入力し直させる', async () => {
    const { prompt } = answers('not a url', 'http://localhost:11434/v1');

    await expect(askCustomBaseUrl(prompt)).resolves.toBe('http://localhost:11434/v1');
    expect(printed()).toContain('URL として読めません');
  });

  it('プリセットにもローカルにも無いホストは、API キーの送り先を見せて確認を取る', async () => {
    const { prompt, asked } = answers('https://llm.example.net/v1', 'n', 'https://llm.example.net/v1', 'y');

    await expect(askCustomBaseUrl(prompt)).resolves.toBe('https://llm.example.net/v1');
    expect(printed()).toContain('このホストに API キーが送信されます: llm.example.net');
    // 確認で n を選んだら URL から入力し直す
    expect(asked.filter((q) => q.includes('エンドポイントURL'))).toHaveLength(2);
  });

  it.each(['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080/v1'])(
    'ローカルの %s はそのまま受け付ける',
    async (url) => {
      const { prompt, asked } = answers(url);

      await expect(askCustomBaseUrl(prompt)).resolves.toBe(url);
      expect(asked).toHaveLength(1);
    }
  );

  it.each(['', '   '])('空（%j）なら URL としては受け付けず、LLM なしで進める', async (value) => {
    await expect(askCustomBaseUrl(answers(value).prompt)).resolves.toBeNull();
  });

  it('改行の入った値は受け付けず、入力し直させる', async () => {
    const { prompt } = answers('https://api.openai.com/v1\u0007', 'https://api.openai.com/v1');

    await expect(askCustomBaseUrl(prompt)).resolves.toBe('https://api.openai.com/v1');
    expect(printed()).toContain('改行や制御文字は使えません');
  });
});

describe('setup の部品', () => {
  it.each(['http://127.0.0.1:3000/auth/callback', 'http://[::1]:3000/auth/callback'])(
    'ループバックの Redirect URI %s は使える',
    (uri) => {
      expect(setupRedirectUriProblem(uri)).toBeNull();
    }
  );

  it.each(['https://127.0.0.1:3000/auth/callback', 'http://localhost:3000/auth/callback', 'http://192.168.0.2:3000/cb'])(
    '%s では、setup の一時サーバーで受けられないことを案内する',
    (uri) => {
      expect(setupRedirectUriProblem(uri)).toMatch(/ループバックの Redirect URI/);
    }
  );

  it('一時サーバーは、state の合わないリクエストを断るだけで待ち続け、その後の正しいコールバックで成功する', async () => {
    // 認可コードの交換（fetch）は spec の共通のモックが応答する。一時サーバーへは本物の HTTP で送る
    respondWith((url) =>
      url.includes('accounts.spotify.com/api/token')
        ? jsonOk({ access_token: 'a', refresh_token: 'fresh-refresh-token', expires_in: 3600 })
        : null
    );
    const port = 41_000 + (process.pid % 20_000);
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
    let authorizeUrl = '';
    const flow = runOAuthFlow({ clientId: 'id', clientSecret: 'secret', redirectUri }, (url) => {
      authorizeUrl = url;
    });
    await vi.waitFor(() => expect(authorizeUrl).not.toBe(''));
    const state = new URL(authorizeUrl).searchParams.get('state')!;
    const status = (query: string) =>
      new Promise<number>((done, fail) => {
        get(`${redirectUri}?${query}`, (res) => {
          res.resume();
          done(res.statusCode ?? 0);
        }).on('error', fail);
      });

    expect(await status('code=c&state=wrong')).toBe(400);
    expect(await status(`code=c&state=${state}`)).toBe(200);
    await expect(flow).resolves.toBe('fresh-refresh-token');
  });

  describe('GitHub Secrets（gh を差し替えて、渡す引数を確かめる）', () => {
    function fakeGh(responses: Record<string, { code: number; stdout?: string; stderr?: string }>) {
      const calls: { args: string[]; input: string | undefined }[] = [];
      const gh: GhRunner = (args, input) => {
        calls.push({ args, input });
        const response = responses[args.join(' ')] ?? { code: 0 };
        return Promise.resolve({ code: response.code, stdout: response.stdout ?? '', stderr: response.stderr ?? '' });
      };
      return { gh, calls };
    }

    it('登録と削除には、確認に表示したリポジトリを --repo で渡し、値は標準入力で渡す', async () => {
      const { gh, calls } = fakeGh({});

      await setGitHubSecret(gh, 'me/SpotifyEmbedded', 'LLM_API_KEY', 'secret-value');
      await deleteGitHubSecret(gh, 'me/SpotifyEmbedded', 'LLM_MODEL');

      expect(calls[0]).toEqual({ args: ['secret', 'set', 'LLM_API_KEY', '--repo', 'me/SpotifyEmbedded'], input: 'secret-value' });
      expect(calls[1]?.args).toEqual(['secret', 'delete', 'LLM_MODEL', '--repo', 'me/SpotifyEmbedded']);
    });

    it('削除は、元から無い（not found）ときだけ成功として扱い、権限エラーは理由を示して失敗する', async () => {
      const missing = fakeGh({ 'secret delete K --repo r': { code: 1, stderr: 'HTTP 404: Not Found' } });
      const denied = fakeGh({ 'secret delete K --repo r': { code: 1, stderr: 'HTTP 403: Resource not accessible by integration' } });

      await expect(deleteGitHubSecret(missing.gh, 'r', 'K')).resolves.toBeUndefined();
      await expect(deleteGitHubSecret(denied.gh, 'r', 'K')).rejects.toThrow(/403/);
    });

    it('gh repo fork --clone した作業ツリーでは、フォーク元ではなく自分のフォークを提案する', async () => {
      const { gh } = fakeGh({
        'repo view --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'Sh1n1230/SpotifyEmbedded\n' },
        'api user -q .login': { code: 0, stdout: 'me\n' },
        'repo view me/SpotifyEmbedded --json nameWithOwner -q .nameWithOwner': { code: 0, stdout: 'me/SpotifyEmbedded\n' },
      });

      await expect(currentRepo(gh)).resolves.toBe('me/SpotifyEmbedded');
    });
  });

  it('Windows では cmd.exe を通さずに開き、& を含む認可 URL を1つの引数のまま渡す', () => {
    const url = 'https://accounts.spotify.com/authorize?response_type=code&client_id=abc&state=xyz';

    const win = browserCommand(url, 'win32');

    expect(win.command).not.toMatch(/cmd/i);
    expect(win.args.at(-1)).toBe(url);
    expect(browserCommand(url, 'darwin')).toEqual({ command: 'open', args: [url] });
    expect(browserCommand(url, 'linux')).toEqual({ command: 'xdg-open', args: [url] });
  });

  it('refresh_token を取り直す目安は、取得日から6か月後（日本時間）', () => {
    expect(refreshTokenRenewalDate(new Date('2026-09-21T12:00:00Z'))).toBe('2027-03-21');
    // 日本時間ではもう翌日
    expect(refreshTokenRenewalDate(new Date('2026-10-27T20:00:00Z'))).toBe('2027-04-28');
  });

  it.each([
    // setUTCMonth would overflow these into the following month; clamp to EOM.
    ['2026-08-31T12:00:00Z', '2027-02-28'],
    ['2026-03-31T12:00:00Z', '2026-09-30'],
    ['2026-12-31T12:00:00Z', '2027-06-30'],
  ] as const)(
    '月末取得の目安は6か月後の月の末日以前になる (%s → %s)',
    (issued, expected) => {
      expect(refreshTokenRenewalDate(new Date(issued))).toBe(expected);
    }
  );

  it.each([
    ['改行', 'abc\nLLM_BASE_URL=https://evil.example', 'text'],
    ['CR', 'abc\rdef', 'text'],
    ['制御文字', 'abc\u0007', 'text'],
    ['トークンの空白', 'abc def', 'token'],
  ] as const)('%s を含む入力は受け付けない', (_, value, kind) => {
    expect(invalidInputReason(value, kind)).not.toBeNull();
  });

  it('普通の値は受け付ける', () => {
    expect(invalidInputReason('gemini-3.1-flash-lite', 'text')).toBeNull();
    expect(invalidInputReason('AQD-abc_123', 'token')).toBeNull();
  });
});
