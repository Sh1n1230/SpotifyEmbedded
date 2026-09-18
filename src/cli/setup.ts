/**
 * 対話セットアップ。
 *
 * 従来は「npm run auth → ターミナルの出力をコピー → .env に貼る →
 * 再起動 → デプロイ先の環境変数にも貼り直す」という往復が必要だった。
 * このコマンドはブラウザでの承認以外の手作業をすべて引き受ける。
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';
import { resolve } from 'node:path';

import {
  AUTH_ENV,
  AUTH_FIELDS,
  authStorePath,
  resolveAuthValue,
  saveStoredAuth,
  type AuthField,
  type StoredAuth,
} from '../authStore.js';
import { buildAuthorizeUrl, exchangeCodeForTokens, type OAuthApp } from '../spotify/oauth.js';
import { PROVIDERS, DEFAULT_BASE_URL, providerLabelForBaseUrl } from '../llm/providers.js';

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export async function setup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('\n🎵 SpotifyEmbedded セットアップ\n');

    const redirectUri =
      process.env['SPOTIFY_REDIRECT_URI'] ?? 'http://127.0.0.1:3000/auth/callback';

    const clientId = await ensureValue(rl, 'spotifyClientId', {
      label: 'Spotify Client ID',
      hint:
        'https://developer.spotify.com/dashboard でアプリを作成し、\n' +
        `  Redirect URIs に ${redirectUri} を登録しておいてください。`,
      secret: false,
    });
    const clientSecret = await ensureValue(rl, 'spotifyClientSecret', {
      label: 'Spotify Client Secret',
      secret: true,
    });

    const llm = await askLlm(rl);

    const app: OAuthApp = { clientId, clientSecret, redirectUri };

    console.log('\nブラウザで Spotify の承認画面を開きます...');
    const refreshToken = await runOAuthFlow(app);
    console.log('✓ refresh_token を取得しました');

    const values: StoredAuth = {
      spotifyClientId: clientId,
      spotifyClientSecret: clientSecret,
      spotifyRefreshToken: refreshToken,
      ...llm,
    };

    saveStoredAuth(values);
    console.log(`✓ ${authStorePath()} に保存しました (0600)`);

    upsertEnvFile(resolve('.env'), values);
    console.log('✓ .env を更新しました');

    await offerGitHubSecrets(rl, values);

    console.log('\n完了しました。次のいずれかで使えます:\n');
    console.log('  npm run dev        # ライブAPIサーバーを起動');
    console.log('  npm run generate   # 静的ファイルを ./out に生成');
    if (!llm.llmApiKey) {
      console.log('\n※ LLM未設定のため、ムード文なしで動作します。');
      console.log('  あとから有効にするには、もう一度 `npm run setup` を実行してください。');
    }
    console.log('');
  } finally {
    rl.close();
  }
}

// ── 入力 ─────────────────────────────────────────────────────────────

interface AskOptions {
  label: string;
  hint?: string;
  secret: boolean;
  optional?: boolean;
}

/** 既に設定済みならそれを使い、無ければ対話で聞く。 */
async function ensureValue(
  rl: Interface,
  field: AuthField,
  options: AskOptions
): Promise<string> {
  const existing = resolveAuthValue(field);
  if (existing) {
    console.log(`✓ ${options.label} は設定済みです (${AUTH_ENV[field]})`);
    return existing;
  }

  if (options.hint) console.log(`\n${options.label}\n  ${options.hint}`);
  else console.log(`\n${options.label}`);

  for (;;) {
    const answer = (await ask(rl, `  ${options.label}: `, options.secret)).trim();
    if (answer) return answer;
    if (options.optional) return '';
    console.log('  値を入力してください。');
  }
}

/**
 * ムード文を生成するLLMの選択。
 *
 * OpenAI互換のエンドポイントなら提供元は問わないので、代表的なものを
 * プリセットで出しつつ、任意のURLも受け付ける。丸ごとスキップもできる。
 */
async function askLlm(rl: Interface): Promise<StoredAuth> {
  const existingKey = resolveAuthValue('llmApiKey');
  if (existingKey) {
    const baseUrl = resolveAuthValue('llmBaseUrl') ?? DEFAULT_BASE_URL;
    console.log(`\n✓ LLM は設定済みです (${providerLabelForBaseUrl(baseUrl)})`);
    return {};
  }

  console.log('\nAIのムード文を生成するLLMを選びます。');
  console.log('OpenAI互換のエンドポイントであれば、どこでも使えます。\n');

  PROVIDERS.forEach((provider, i) => {
    const note = provider.note ? `  — ${provider.note}` : '';
    console.log(`  ${i + 1}) ${provider.label}${note}`);
  });
  console.log(`  ${PROVIDERS.length + 1}) 使わない（曲情報のみ表示する）`);

  const choice = (await ask(rl, `\n  番号 (1-${PROVIDERS.length + 1}): `, false)).trim();
  const index = Number.parseInt(choice, 10) - 1;

  if (!Number.isInteger(index) || index < 0 || index >= PROVIDERS.length) {
    console.log('  → ムード文なしで進めます。');
    return {};
  }

  const preset = PROVIDERS[index];
  if (!preset) return {};

  let baseUrl = preset.baseUrl;
  if (!baseUrl) {
    baseUrl = (
      await ask(rl, '  エンドポイントURL (例: http://localhost:11434/v1): ', false)
    ).trim();
    if (!baseUrl) {
      console.log('  → URLが空のため、ムード文なしで進めます。');
      return {};
    }
  }

  if (preset.signupUrl) console.log(`\n  APIキーの発行: ${preset.signupUrl}`);
  const apiKey = (await ask(rl, '  APIキー: ', true)).trim();
  if (!apiKey) {
    console.log('  → キーが空のため、ムード文なしで進めます。');
    return {};
  }

  const modelPrompt = preset.defaultModel
    ? `  モデル名 [${preset.defaultModel}]: `
    : '  モデル名: ';
  const model = (await ask(rl, modelPrompt, false)).trim() || preset.defaultModel;

  if (!model) {
    console.log('  → モデル名が空のため、ムード文なしで進めます。');
    return {};
  }

  return { llmApiKey: apiKey, llmBaseUrl: baseUrl, llmModel: model };
}

function ask(rl: Interface, query: string, secret: boolean): Promise<string> {
  if (!secret) return new Promise((done) => rl.question(query, done));

  // 入力エコーを伏せる。readline の内部APIなので、使えない環境では
  // そのまま表示される（機能は失われない）。
  return new Promise((done) => {
    const target = rl as unknown as { _writeToOutput?: (text: string) => void };
    const original = target._writeToOutput?.bind(rl);

    if (original) {
      target._writeToOutput = (text: string) => {
        if (text.includes(query)) original(text);
        else if (text.trim() !== '') original('*');
        else original(text);
      };
    }

    rl.question(query, (answer) => {
      if (original) target._writeToOutput = original;
      process.stdout.write('\n');
      done(answer);
    });
  });
}

// ── OAuth ────────────────────────────────────────────────────────────

/** ローカルに一時サーバーを立て、ブラウザの承認が戻ってくるのを待つ。 */
async function runOAuthFlow(app: OAuthApp): Promise<string> {
  const callback = new URL(app.redirectUri);
  const port = Number(callback.port || '3000');
  const state = randomBytes(16).toString('hex');

  return new Promise<string>((done, fail) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${callback.host}`);
      if (url.pathname !== callback.pathname) {
        res.writeHead(404).end();
        return;
      }

      const finish = (status: number, message: string, error?: Error): void => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(resultPage(message, !error));
        server.close();
        clearTimeout(timer);
        if (error) fail(error);
      };

      if (url.searchParams.get('state') !== state) {
        finish(400, 'state が一致しません。もう一度やり直してください。', new Error('state mismatch'));
        return;
      }

      const spotifyError = url.searchParams.get('error');
      if (spotifyError) {
        finish(400, `承認がキャンセルされました (${spotifyError})`, new Error(spotifyError));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        finish(400, '認可コードが取得できませんでした。', new Error('missing code'));
        return;
      }

      exchangeCodeForTokens(app, code)
        .then((tokens) => {
          finish(200, '認証が完了しました。ターミナルに戻ってください。');
          done(tokens.refresh_token);
        })
        .catch((err: Error) => finish(500, err.message, err));
    });

    const timer = setTimeout(() => {
      server.close();
      fail(new Error('承認がタイムアウトしました（5分）。もう一度実行してください。'));
    }, CALLBACK_TIMEOUT_MS);

    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      fail(
        err.code === 'EADDRINUSE'
          ? new Error(
              `ポート ${port} が使用中です。開発サーバーを停止してから、もう一度実行してください。`
            )
          : err
      );
    });

    server.listen(port, callback.hostname, () => {
      const authorizeUrl = buildAuthorizeUrl(app, state);
      openBrowser(authorizeUrl);
      console.log('  ブラウザが開かない場合は、次のURLを手動で開いてください:');
      console.log(`  ${authorizeUrl}\n`);
    });
  });
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';

  try {
    const child = spawn(command, [url], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    });
    child.on('error', () => {
      /* 手動で開いてもらう */
    });
    child.unref();
  } catch {
    /* 手動で開いてもらう */
  }
}

function resultPage(message: string, ok: boolean): string {
  // message は自前の固定文か Error.message のみ。リクエスト由来の値は入れない。
  const safe = message.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>SpotifyEmbedded</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0e1013;color:#f2f4f7">
<div style="text-align:center"><p style="font-size:2rem;margin:0 0 1rem">${ok ? '✅' : '⚠️'}</p><p style="margin:0">${safe}</p></div>
</body></html>`;
}

// ── 保存先 ───────────────────────────────────────────────────────────

/** .env の該当行だけを差し替える。他の行やコメントは触らない。 */
function upsertEnvFile(path: string, values: StoredAuth): void {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];

  for (const field of AUTH_FIELDS) {
    const value = values[field];
    if (!value) continue;

    const key = AUTH_ENV[field];
    const entry = `${key}=${value}`;
    const index = lines.findIndex((line) => line.trimStart().startsWith(`${key}=`));

    if (index >= 0) lines[index] = entry;
    else lines.push(entry);
  }

  const content = lines.join('\n');
  writeFileSync(path, content.endsWith('\n') ? content : content + '\n', { mode: 0o600 });
}

/** gh CLI があれば GitHub Secrets への登録まで済ませる。 */
async function offerGitHubSecrets(rl: Interface, values: StoredAuth): Promise<void> {
  const repo = await currentRepo();
  if (!repo) {
    console.log('\nGitHub Actions で静的生成する場合は、リポジトリの Secrets に');
    console.log('以下を登録してください（gh CLI があれば自動登録できます）:\n');
    printEnvBlock(values);
    return;
  }

  const answer = (
    await ask(rl, `\n${repo} の GitHub Secrets にも登録しますか？ (Y/n): `, false)
  ).trim().toLowerCase();

  if (answer === 'n' || answer === 'no') {
    printEnvBlock(values);
    return;
  }

  for (const field of AUTH_FIELDS) {
    const value = values[field];
    if (!value) continue;

    const key = AUTH_ENV[field];
    try {
      await setGitHubSecret(key, value);
      console.log(`  ✓ ${key}`);
    } catch (err) {
      console.log(`  ✗ ${key}: ${(err as Error).message}`);
    }
  }
}

/** gh CLI が使えて、かつ cwd がGitHubリポジトリなら "owner/name" を返す。 */
async function currentRepo(): Promise<string | null> {
  try {
    const status = await run('gh', ['auth', 'status']);
    if (status.code !== 0) return null;

    const view = await run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    if (view.code !== 0) return null;

    const name = view.stdout.trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * 値はコマンド引数ではなく stdin で渡す。
 * 引数に書くと ps などから他プロセスに見えてしまう。
 */
function setGitHubSecret(key: string, value: string): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn('gh', ['secret', 'set', key], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) done();
      else fail(new Error(stderr.trim() || `gh secret set が終了コード ${code} で失敗しました`));
    });

    child.stdin.end(value);
  });
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? 1, stdout }));
  });
}

function printEnvBlock(values: StoredAuth): void {
  for (const field of AUTH_FIELDS) {
    const value = values[field];
    if (value) console.log(`  ${AUTH_ENV[field]}=${value}`);
  }
  console.log('');
}
