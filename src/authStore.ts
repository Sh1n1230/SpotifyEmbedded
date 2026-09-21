/**
 * 認証情報・LLM設定の解決と永続化。
 *
 * 解決順は「環境変数 → data/auth.json → 未設定」。
 * 環境変数を最優先にしているため、従来どおり .env / プラットフォームの
 * シークレット機能だけで運用している場合の挙動は一切変わらない。
 *
 * data/auth.json は `npm run setup` が書き込む。CLI をローカルで回す場合や、
 * 書き込み可能なディスクを持つ環境で再起動なしに設定を完了させたい場合に使う。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** 保存や表示に使う正規の環境変数名。 */
export const AUTH_ENV: Record<AuthField, string> = {
  spotifyClientId: 'SPOTIFY_CLIENT_ID',
  spotifyClientSecret: 'SPOTIFY_CLIENT_SECRET',
  spotifyRefreshToken: 'SPOTIFY_REFRESH_TOKEN',
  llmApiKey: 'LLM_API_KEY',
  llmBaseUrl: 'LLM_BASE_URL',
  llmModel: 'LLM_MODEL',
};

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
      if (typeof value === 'string' && value !== '') next[field] = value;
    }
    // 旧フィールド名からの移行（groqApiKey → llmApiKey）
    if (!next.llmApiKey && typeof source['groqApiKey'] === 'string' && source['groqApiKey'] !== '') {
      next.llmApiKey = source['groqApiKey'];
    }
    cached = next;
  } catch (err) {
    console.warn(`[auth] ${path} を読み込めませんでした。無視します:`, err);
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
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
  // 既存ファイルがある場合 writeFileSync の mode は適用されないため明示的に絞る
  chmodSync(path, 0o600);

  cached = merged;
}

/** 環境変数（別名を含む）→ data/auth.json の順で解決する。 */
export function resolveAuthValue(field: AuthField): string | undefined {
  for (const name of AUTH_ENV_NAMES[field]) {
    const value = process.env[name];
    if (value) return value;
  }
  return loadStoredAuth()[field];
}

/** 解決できなければ、次に何をすべきかを示して throw する。 */
export function requireAuthValue(field: AuthField): string {
  const value = resolveAuthValue(field);
  if (!value) {
    throw new Error(
      `${AUTH_ENV[field]} が設定されていません。環境変数に設定するか、\`npm run setup\` を実行してください。`
    );
  }
  return value;
}

/** 必須項目のうち未設定のものの環境変数名一覧。空配列なら起動可能。 */
export function missingAuthValues(): string[] {
  return REQUIRED_FIELDS.filter((field) => resolveAuthValue(field) === undefined).map(
    (field) => AUTH_ENV[field]
  );
}

/** ムード文を生成できる状態か。 */
export function hasLlmConfigured(): boolean {
  return resolveAuthValue('llmApiKey') !== undefined;
}
