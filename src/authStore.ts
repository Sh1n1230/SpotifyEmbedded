/**
 * 認証情報の解決と永続化。
 *
 * 解決順は「環境変数 → data/auth.json → 未設定」。
 * 環境変数を最優先にしているため、従来どおり .env / プラットフォームの
 * シークレット機能だけで運用している場合の挙動は一切変わらない。
 *
 * data/auth.json は `spotify-embedded setup` が書き込む。CLI をローカルで
 * 回す場合や、書き込み可能なディスクを持つ環境で再起動なしに認証を
 * 完了させたい場合に使う。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface StoredAuth {
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  spotifyRefreshToken?: string;
  groqApiKey?: string;
}

export type AuthField = keyof StoredAuth;

/** 各フィールドに対応する環境変数名。setup の出力にもそのまま使う。 */
export const AUTH_ENV: Record<AuthField, string> = {
  spotifyClientId: 'SPOTIFY_CLIENT_ID',
  spotifyClientSecret: 'SPOTIFY_CLIENT_SECRET',
  spotifyRefreshToken: 'SPOTIFY_REFRESH_TOKEN',
  groqApiKey: 'GROQ_API_KEY',
};

export const AUTH_FIELDS = Object.keys(AUTH_ENV) as AuthField[];

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
    cached = next;
  } catch (err) {
    console.warn(`[auth] ${path} を読み込めませんでした。無視します:`, err);
    cached = {};
  }
  return cached;
}

/**
 * data/auth.json に書き込む（既存の内容とマージ）。
 * 秘密情報なのでファイルは 0600 で作成する。
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

/** 環境変数 → data/auth.json の順で解決する。未設定なら undefined。 */
export function resolveAuthValue(field: AuthField): string | undefined {
  const fromEnv = process.env[AUTH_ENV[field]];
  if (fromEnv) return fromEnv;
  return loadStoredAuth()[field];
}

/** 解決できなければ、次に何をすべきかを示して throw する。 */
export function requireAuthValue(field: AuthField): string {
  const value = resolveAuthValue(field);
  if (!value) {
    throw new Error(
      `${AUTH_ENV[field]} が設定されていません。` +
        '環境変数に設定するか、`npx spotify-embedded setup` を実行してください。'
    );
  }
  return value;
}

/** 未設定の必須項目の環境変数名一覧。空配列なら起動可能。 */
export function missingAuthValues(): string[] {
  return AUTH_FIELDS.filter((field) => resolveAuthValue(field) === undefined).map(
    (field) => AUTH_ENV[field]
  );
}
