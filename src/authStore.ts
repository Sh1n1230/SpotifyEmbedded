/**
 * 認証情報・LLM設定の解決と永続化。
 *
 * 解決順は「環境変数 → data/auth.json → 未設定」。
 * 環境変数を最優先にしているため、従来どおり .env / プラットフォームの
 * シークレット機能だけで運用している場合の挙動は一切変わらない。
 *
 * data/auth.json は `npm run setup` が書き込む。CLI をローカルで回す場合や、
 * 書き込み可能なディスクを持つ環境で再起動なしに設定を完了させたい場合に使う。
 * 読むのは最初の1回と、必須の値が見つからなかったとき（requireAuthValue）だけ。動いているサーバーの横で
 * `npm run setup` を実行すると、次に値が要ったときに読み直して反映される（成功している間はファイルを読まない）。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface StoredAuth {
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  spotifyRefreshToken?: string;
  /** OpenAI互換エンドポイントのAPIキー。未設定ならムード文なしで動く。 */
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
}

export type AuthField = keyof StoredAuth;

/**
 * 各フィールドが読む環境変数名。先頭が正規名で、以降は別名。
 *
 * 別名を持たせているのは、GROQ_API_KEY や OPENAI_API_KEY といった
 * すでに設定されがちな名前をそのまま拾うため。旧バージョンからの
 * 移行でも設定を書き換えなくて済む。
 */
const AUTH_ENV_NAMES: Record<AuthField, string[]> = {
  spotifyClientId: ['SPOTIFY_CLIENT_ID'],
  spotifyClientSecret: ['SPOTIFY_CLIENT_SECRET'],
  spotifyRefreshToken: ['SPOTIFY_REFRESH_TOKEN'],
  llmApiKey: [
    'LLM_API_KEY',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
  ],
  llmBaseUrl: ['LLM_BASE_URL', 'OPENAI_BASE_URL'],
  llmModel: ['LLM_MODEL', 'GROQ_MODEL'],
};

/** 正規名と別名のすべて。設定ファイルから項目を消すときは、別名の行も消さないと値が生き残る。 */
export function authEnvNames(field: AuthField): readonly string[] {
  return AUTH_ENV_NAMES[field];
}

/** 保存や表示に使う正規の環境変数名。 */
/** 各フィールドの正規名（AUTH_ENV_NAMES の先頭）。 */
export const AUTH_ENV = Object.fromEntries(
  Object.entries(AUTH_ENV_NAMES).map(([field, names]) => [field, names[0]])
) as Record<AuthField, string>;

export const AUTH_FIELDS = Object.keys(AUTH_ENV) as AuthField[];

/**
 * これが無いと何も取得できない項目。
 * LLM関連は任意で、未設定ならムード文を省いて動作する。
 */
export const REQUIRED_FIELDS: AuthField[] = [
  'spotifyClientId',
  'spotifyClientSecret',
  'spotifyRefreshToken',
];

export function authStorePath(): string {
  return resolve(process.env['AUTH_STORE_PATH'] ?? 'data/auth.json');
}

let cached: StoredAuth | null = null;

/** data/auth.json を読む。存在しない・壊れている場合は空として扱う。 */
export function loadStoredAuth(forceReload = false): StoredAuth {
  if (cached && !forceReload) return cached;

  const path = authStorePath();
  if (!existsSync(path)) {
    cached = {};
    return cached;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      cached = {};
      return cached;
    }
    const source = parsed as Record<string, unknown>;
    const next: StoredAuth = {};
    for (const field of AUTH_FIELDS) {
      const value = source[field];
      const cleaned = typeof value === 'string' ? cleanAuthValue(value, `${path} の ${field}`) : undefined;
      if (cleaned) next[field] = cleaned;
    }
    // 旧フィールド名からの移行（groqApiKey → llmApiKey）
    if (!next.llmApiKey && typeof source['groqApiKey'] === 'string') {
      const legacy = cleanAuthValue(source['groqApiKey'], `${path} の groqApiKey`);
      if (legacy) next.llmApiKey = legacy;
    }
    cached = next;
  } catch (err) {
    // JSON.parse のエラー文は本文の一部を引用する（`Unexpected token 'A', "AQD…" is not valid JSON`）。
    // このファイルの中身は秘密情報なので、JSON として読めないときは理由の種類だけを出す
    const reason = err instanceof SyntaxError ? 'JSON として読めません' : err instanceof Error ? err.message : String(err);
    console.warn('[auth] %s を読み込めませんでした。無視します: %s', path, reason);
    cached = {};
  }
  return cached;
}

/**
 * data/auth.json に書き込む（既存の内容とマージ）。
 * 秘密情報を含むのでファイルは 0600 で作成する。
 */
export function saveStoredAuth(update: StoredAuth): void {
  const path = authStorePath();
  const merged: StoredAuth = { ...loadStoredAuth(true), ...update };

  mkdirSync(dirname(path), { recursive: true });
  // 一時ファイルに書いてから置き換える。その場で書き換えると、途中で落ちたときに refresh_token を失う
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
    // 同じ名前の一時ファイルが残っていると writeFileSync の mode は適用されないため明示的に絞る
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }

  cached = merged;
}

const warnedInnerWhitespace = new Set<string>();

/**
 * 設定値の前後の空白・改行を取り除く。空になったら未設定（undefined）。
 *
 * 改行付きでパイプした値や、ダッシュボードに行末ごと貼り付けた値は末尾に改行が付く。そのままだと
 * Basic 認証の値がずれて Spotify は invalid_client を返し、値そのものは正しいので原因にたどり着けない。
 * 前後を除いても空白・制御文字が残る値は、貼り付けの誤りの可能性が高いので、値を出さずに一度だけ知らせる。
 *
 * @param label 警告に出す、値の在りか（環境変数名など）
 */
function cleanAuthValue(value: string | undefined, label: string): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  if (/[\s\p{Cc}]/u.test(cleaned) && !warnedInnerWhitespace.has(label)) {
    warnedInnerWhitespace.add(label);
    console.warn(`[auth] ${label} に空白か制御文字が含まれています。貼り付けた値を確かめてください。`);
  }
  return cleaned;
}

/** 環境変数の値（前後の空白を除く）。未設定・空白だけなら undefined。 */
function envValue(name: string): string | undefined {
  return cleanAuthValue(process.env[name], name);
}

/** 環境変数（別名を含む）→ data/auth.json の順で解決する。 */
export function resolveAuthValue(field: AuthField): string | undefined {
  for (const name of AUTH_ENV_NAMES[field]) {
    const value = envValue(name);
    if (value) return value;
  }
  return loadStoredAuth()[field];
}

/** 環境変数から読んでいるなら、その名前（別名を含む）。data/auth.json から・未設定なら null。 */
export function authValueEnvName(field: AuthField): string | null {
  return AUTH_ENV_NAMES[field].find((name) => envValue(name)) ?? null;
}

/** その値をどこから読んでいるか。書き換えてよい保存先かを判断するために使う。 */
export function authValueSource(field: AuthField): 'env' | 'file' | null {
  if (authValueEnvName(field)) return 'env';
  return loadStoredAuth()[field] ? 'file' : null;
}

/**
 * 必須の設定が無い。コードの不具合ではなく運用者が直す設定の欠落なので、ライブAPIは 500 ではなく 503 で返す
 * （環境変数名は公開エンドポイントには出さず、ログにだけ出す）。
 */
export class MissingConfigError extends Error {
  /** 欠けている設定の正規の環境変数名 */
  readonly names: readonly string[];
  constructor(names: readonly string[]) {
    super(
      `${names.join(', ')} が設定されていません。環境変数に設定するか、\`npm run setup\` を実行してください` +
        '（Workers では `npx wrangler secret put <名前>`）。'
    );
    this.name = 'MissingConfigError';
    this.names = names;
  }
}

/** 解決できなければ、次に何をすべきかを示して throw する。 */
export function requireAuthValue(field: AuthField): string {
  // 見つからなければ data/auth.json を読み直す（起動の後に npm run setup で書かれた場合に、再起動なしで反映する）
  let value = resolveAuthValue(field);
  if (!value) {
    loadStoredAuth(true);
    value = resolveAuthValue(field);
  }
  if (!value) throw new MissingConfigError([AUTH_ENV[field]]);
  return value;
}

/** 必須項目のうち未設定のものの環境変数名一覧。空配列なら起動可能。 */
export function missingAuthValues(): string[] {
  return REQUIRED_FIELDS.filter((field) => resolveAuthValue(field) === undefined).map(
    (field) => AUTH_ENV[field]
  );
}

// ムード文を生成できる状態か（hasLlmConfigured）は、送り先とモデルの決め方と一緒に src/llm/settings.ts にある
