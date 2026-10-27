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
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';
import { resolve } from 'node:path';

import {
  AUTH_ENV,
  AUTH_FIELDS,
  authEnvNames,
  authStorePath,
  resolveAuthValue,
  saveStoredAuth,
  type AuthField,
  type StoredAuth,
} from '../authStore.js';
import { buildAuthorizeUrl, exchangeCodeForTokens, type OAuthApp } from '../spotify/oauth.js';
import { PROVIDERS, DEFAULT_BASE_URL, providerLabelForBaseUrl } from '../llm/providers.js';
import { chatCompletion } from '../llm/client.js';
import { isLocalLlmEndpoint, llmBaseUrlProblem } from '../llm/endpoint.js';
import { formatDateJa } from '../render/theme.js';

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Spotify の refresh_token の寿命。使い続けても延びない。
 * https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
 */
const REFRESH_TOKEN_LIFETIME_MONTHS = 6;

/** 取り直しの目安の日付（取得日から6か月後、日本時間の YYYY-MM-DD）。 */
export function refreshTokenRenewalDate(issuedAt: Date): string {
  const renewal = new Date(issuedAt);
  renewal.setUTCMonth(renewal.getUTCMonth() + REFRESH_TOKEN_LIFETIME_MONTHS);
  return formatDateJa(renewal);
}

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
    console.log(
      `  有効期限は承認から${REFRESH_TOKEN_LIFETIME_MONTHS}か月です。` +
        `${refreshTokenRenewalDate(new Date())} ごろまでに \`npm run setup\` で取り直してください。`
    );

    const values: StoredAuth = {
      spotifyClientId: clientId,
      spotifyClientSecret: clientSecret,
      spotifyRefreshToken: refreshToken,
      ...llm,
    };

    saveStoredAuth(values);
    console.log(`✓ ${authStorePath()} に保存しました (0600)`);

    const removed = upsertEnvFile(resolve('.env'), values);
    console.log('✓ .env を更新しました');
    if (removed.length > 0) console.log(`  （削除した行: ${removed.join(', ')}）`);

    await offerGitHubSecrets(rl, values);

    console.log('\n完了しました。次のいずれかで使えます:\n');
    console.log('  npm run dev        # ライブAPIサーバーを起動');
    console.log('  npm run generate   # 静的ファイルを ./out に生成');
    // 維持を選んだ場合 askLlm は {} を返すため、保存済みのキーも見て判定する。
    if (!llm.llmApiKey && !resolveAuthValue('llmApiKey')) {
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
    const answer = await askValue(prompter(rl), `  ${options.label}: `, options.secret ? 'token' : 'text');
    if (answer) return answer;
    if (options.optional) return '';
    console.log('  値を入力してください。');
  }
}

/**
 * 入力として受け付けられない理由。受け付けられれば null。
 *
 * 値は設定ファイルに `KEY=value` の1行として書くので、改行が入ると別の行（別の環境変数）を
 * 差し込めてしまう。制御文字も同じく弾く。トークン・キーは空白も含まない。
 */
export function invalidInputReason(value: string, kind: 'text' | 'token'): string | null {
  // eslint-disable-next-line no-control-regex -- 改行・制御文字を弾くため、意図して指定している
  if (/[\u0000-\u001f\u007f]/.test(value)) return '改行や制御文字は使えません。';
  if (kind === 'token' && /\s/.test(value)) return '空白は使えません。';
  return null;
}

/** 1行を聞く関数。テストでは決まった答えを返すものに差し替える。 */
export type Prompt = (query: string, secret: boolean) => Promise<string>;

function prompter(rl: Interface): Prompt {
  return (query, secret) => ask(rl, query, secret);
}

/** 1行を聞き、受け付けられない値なら理由を出して聞き直す。前後の空白は落とす。 */
async function askValue(prompt: Prompt, query: string, kind: 'text' | 'token'): Promise<string> {
  for (;;) {
    const answer = (await prompt(query, kind === 'token')).trim();
    const reason = invalidInputReason(answer, kind);
    if (!reason) return answer;
    console.log(`  ${reason}もう一度入力してください。`);
  }
}

/**
 * 「その他」で入力されたエンドポイント URL を確かめる。API キーはここへ送られるので、
 * 形式・スキームを検査し、プリセットにもローカルにも無いホストなら送り先を見せて確認を取る。
 * 空なら null（LLM なしで進める）。
 */
export async function askCustomBaseUrl(prompt: Prompt): Promise<string | null> {
  for (;;) {
    const baseUrl = await askValue(prompt, '  エンドポイントURL (例: http://localhost:11434/v1): ', 'text');
    if (!baseUrl) return null;

    const problem = llmBaseUrlProblem(baseUrl);
    if (problem) {
      console.log(`  ✗ ${problem}`);
      continue;
    }

    const known = PROVIDERS.some((provider) => provider.baseUrl && baseUrl.startsWith(provider.baseUrl));
    if (known || isLocalLlmEndpoint(baseUrl)) return baseUrl;

    console.log(`  このホストに API キーが送信されます: ${new URL(baseUrl).host}`);
    const answer = (await prompt('  このホストで合っていますか？ (y/N): ', false)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return baseUrl;
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
    console.log(`  モデル: ${resolveAuthValue('llmModel') ?? '(既定)'}`);

    // 設定済みでも、キーの期限切れや失効はここでしか直せない。
    // 黙って残すと「設定済みなのにムード文が出ない」状態から抜け出せない。
    const again = (
      await ask(rl, '  入れ替えますか？（期限切れ・失効した場合） (y/N): ', false)
    ).trim().toLowerCase();

    if (again !== 'y' && again !== 'yes') return {};
    console.log('  → 新しい設定を入力してください。');
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
    // 入れ替えの途中でここに来た場合は、古いキーを残さず消す。
    return existingKey ? { llmApiKey: '', llmBaseUrl: '', llmModel: '' } : {};
  }

  const preset = PROVIDERS[index];
  if (!preset) return {};

  let baseUrl = preset.baseUrl;
  if (!baseUrl) {
    const custom = await askCustomBaseUrl(prompter(rl));
    if (!custom) {
      console.log('  → URLが空のため、ムード文なしで進めます。');
      return {};
    }
    baseUrl = custom;
  }

  if (preset.signupUrl) console.log(`\n  APIキーの発行: ${preset.signupUrl}`);
  const apiKey = await askValue(prompter(rl), '  APIキー: ', 'token');
  if (!apiKey) {
    console.log('  → キーが空のため、ムード文なしで進めます。');
    return {};
  }

  const modelPrompt = preset.defaultModel
    ? `  モデル名 [${preset.defaultModel}]: `
    : '  モデル名: ';
  const model = (await askValue(prompter(rl), modelPrompt, 'text')) || preset.defaultModel;

  if (!model) {
    console.log('  → モデル名が空のため、ムード文なしで進めます。');
    return {};
  }

  const settings: StoredAuth = { llmApiKey: apiKey, llmBaseUrl: baseUrl, llmModel: model };

  // ここで一度実際に叩いておく。設定ミス（URLのパス違い・モデル名の誤りなど）は
  // 黙って mood: null になるだけで、あとから気づきにくい。
  return (await verifyLlm(rl, settings)) ? settings : askLlm(rl);
}

/**
 * 入力されたLLM設定で実際に1文生成してみる。
 * 失敗したら原因を見せて、入力し直すか、このまま保存するかを選ばせる。
 */
async function verifyLlm(rl: Interface, settings: StoredAuth): Promise<boolean> {
  console.log('\n  接続を確認しています...');

  try {
    const text = await chatCompletion({
      baseUrl: settings.llmBaseUrl ?? DEFAULT_BASE_URL,
      apiKey: settings.llmApiKey ?? '',
      model: settings.llmModel ?? '',
      messages: [
        { role: 'system', content: '15〜30文字の日本語1文のみを出力する。説明やクォートは付けない。' },
        { role: 'user', content: '曲名: Sunflower\nアーティスト: Post Malone' },
      ],
      maxTokens: 80,
      temperature: 0.7,
    });
    console.log(`  ✓ 生成できました: ${text.trim()}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    const answer = (await ask(rl, '  入力し直しますか？ (Y/n): ', false)).trim().toLowerCase();
    if (answer === 'n' || answer === 'no') {
      console.log('  → このまま保存します（ムード文は出ないかもしれません）。');
      return true;
    }
    return false;
  }
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

/**
 * 既定のブラウザで URL を開くコマンド。
 *
 * Windows で `cmd.exe /c start "" <url>` にすると、cmd.exe が URL の `&` をコマンドの区切りとして
 * 解釈し、認可 URL が `?response_type=code` で切れる（spawn は空白を含まない引数を引用符で囲まない）。
 * cmd.exe を通さず、rundll32 の FileProtocolHandler に URL を1つの引数として渡す。
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform
): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}

function openBrowser(url: string): void {
  const { command, args } = browserCommand(url, process.platform);

  try {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
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

/**
 * 設定ファイルの該当行だけを差し替える。他の行やコメントは触らない。
 *
 * 値が空文字の場合は「明示的に消す」という意味なので、行そのものを削除する。
 * 環境変数は data/auth.json より優先されるため、ここを残すと入れ替えたはずの
 * 古いキーが生き続けてしまう。別名（GROQ_API_KEY など）も読まれるので、消すときは別名の行も消す。
 *
 * @returns 削除した行の変数名
 */
export function upsertEnvFile(path: string, values: StoredAuth): string[] {
  // 入力の段階でも弾いているが、改行の入った値は別の行（別の環境変数）を差し込めるので、書く直前にも確かめる
  for (const field of AUTH_FIELDS) {
    const value = values[field];
    if (value !== undefined && invalidInputReason(value, 'text')) {
      throw new Error(`${AUTH_ENV[field]} に改行や制御文字が含まれているため、書き込みません。`);
    }
  }

  let lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  const removed: string[] = [];

  for (const field of AUTH_FIELDS) {
    const value = values[field];
    if (value === undefined) continue;

    if (value === '') {
      for (const name of authEnvNames(field)) {
        const before = lines.length;
        lines = lines.filter((line) => !line.trimStart().startsWith(`${name}=`));
        if (lines.length < before) removed.push(name);
      }
      continue;
    }

    const key = AUTH_ENV[field];
    const index = lines.findIndex((line) => line.trimStart().startsWith(`${key}=`));
    const entry = `${key}=${value}`;
    if (index >= 0) lines[index] = entry;
    else lines.push(entry);
  }

  const content = lines.join('\n');
  writeFileSync(path, content.endsWith('\n') ? content : content + '\n', { mode: 0o600 });
  // 既存ファイルがある場合 writeFileSync の mode は適用されないため明示的に絞る
  chmodSync(path, 0o600);
  return removed;
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
    if (value === undefined) continue;

    const key = AUTH_ENV[field];
    try {
      // 入れ替えで空にした項目は消す。残ると Actions だけが古いキーで動く。
      if (value === '') {
        await deleteGitHubSecret(key);
        console.log(`  － ${key}（削除）`);
      } else {
        await setGitHubSecret(key, value);
        console.log(`  ✓ ${key}`);
      }
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

/** 不要になったシークレットを消す。元から無い場合も成功扱いにする。 */
async function deleteGitHubSecret(key: string): Promise<void> {
  await run('gh', ['secret', 'delete', key]);
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
    else if (value === '') console.log(`  ${AUTH_ENV[field]} … 登録済みなら削除してください`);
  }
  console.log('');
}
