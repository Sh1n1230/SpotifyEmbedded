/**
 * ムード文に使う LLM の設定（送り先・API キー・モデル）を決める。
 *
 * - 送り先: LLM_BASE_URL（別名 OPENAI_BASE_URL・data/auth.json）。無ければ、API キーをどの名前で
 *   読んだかで決める（OPENAI_API_KEY なら OpenAI）。別のサービスのキーを既定の Gemini に送らないため
 * - モデル: LLM_MODEL。無ければ送り先のプリセットの既定のモデル。プリセットに無い送り先では、
 *   別のサービスのモデル名を送らないよう、未設定として扱う
 * - API キー: ローカルのサーバー（Ollama など）では無くてもよい
 */
import { authValueEnvName, resolveAuthValue } from '../authStore.js';
import { isLocalLlmEndpoint, llmBaseUrlProblem } from './endpoint.js';
import { DEFAULT_BASE_URL, DEFAULT_MODEL, PROVIDERS } from './providers.js';

/** API キーの別名と、LLM_BASE_URL が無いときの送り先 */
const KEY_ALIAS_BASE_URLS: Record<string, string> = {
  OPENAI_API_KEY: 'https://api.openai.com/v1',
  OPENROUTER_API_KEY: 'https://openrouter.ai/api/v1',
  GROQ_API_KEY: 'https://api.groq.com/openai/v1',
  GEMINI_API_KEY: DEFAULT_BASE_URL,
  GOOGLE_API_KEY: DEFAULT_BASE_URL,
};

export interface LlmSettings {
  baseUrl: string;
  /** ローカルのサーバーでキーを設定していなければ null（Authorization を付けない） */
  apiKey: string | null;
  model: string;
}

export type LlmResolution =
  | { kind: 'ready'; settings: LlmSettings }
  | { kind: 'unconfigured' }
  | { kind: 'invalid'; problem: string };

function normalize(url: string): string {
  return url.replace(/\/+$/, '');
}

export function resolveLlm(): LlmResolution {
  const apiKey = resolveAuthValue('llmApiKey') ?? null;
  const keyName = authValueEnvName('llmApiKey');
  const explicitBaseUrl = resolveAuthValue('llmBaseUrl');
  const baseUrl = explicitBaseUrl ?? (keyName ? KEY_ALIAS_BASE_URLS[keyName] : undefined) ?? DEFAULT_BASE_URL;

  // キーが無くてよいのは、送り先を明示したローカルのサーバーだけ
  if (!apiKey && !(explicitBaseUrl && isLocalLlmEndpoint(explicitBaseUrl))) return { kind: 'unconfigured' };

  // 送れない送り先（http のリモートなど）は、曲ごとに失敗させず、設定の誤りとして一度だけ案内できるようにする
  const baseUrlProblem = llmBaseUrlProblem(baseUrl);
  if (baseUrlProblem) return { kind: 'invalid', problem: baseUrlProblem };

  const explicitModel = resolveAuthValue('llmModel');
  const preset = PROVIDERS.find((provider) => provider.baseUrl && normalize(provider.baseUrl) === normalize(baseUrl));
  const model =
    explicitModel ??
    (preset?.defaultModel || undefined) ??
    (normalize(baseUrl) === normalize(DEFAULT_BASE_URL) ? DEFAULT_MODEL : undefined);
  if (!model) {
    return {
      kind: 'invalid',
      problem: `LLM_MODEL が設定されていません。送り先（${baseUrl}）で使うモデル名を LLM_MODEL に設定してください。`,
    };
  }
  return { kind: 'ready', settings: { baseUrl, apiKey, model } };
}

/** ムード文を生成できる状態か。 */
export function hasLlmConfigured(): boolean {
  return resolveLlm().kind === 'ready';
}

/**
 * GOOGLE_API_KEY を LLM のキーとして読んでいるときの案内。この名前は Maps・YouTube など Gemini 以外の
 * Google API でも使われるので、意図せずムード文の生成が始まったときに、起動時のログで分かるようにする。
 */
export function llmKeyNotice(): string | null {
  if (authValueEnvName('llmApiKey') !== 'GOOGLE_API_KEY') return null;
  return (
    'GOOGLE_API_KEY を LLM（Gemini）の API キーとして使い、ムード文を生成します。' +
    'ほかの Google API 用のキーの場合は、LLM_API_KEY か GEMINI_API_KEY に Gemini のキーを設定してください。'
  );
}

/** ムード文の生成のパラメータの既定値と、受け付ける範囲 */
export const LLM_GENERATION = {
  maxTokens: { default: 80, min: 16, max: 4096 },
  temperature: { default: 0.7, min: 0, max: 2 },
} as const;

const warnedGeneration = new Set<string>();

function warnGenerationOnce(name: string, raw: string, used: number, range: { min: number; max: number }): void {
  const key = `${name}=${raw}`;
  if (warnedGeneration.has(key)) return;
  warnedGeneration.add(key);
  console.warn(`${name} は ${range.min}〜${range.max} の数で指定してください（今の値: ${raw}。${used} として扱います）`);
}

/**
 * LLM_MAX_TOKENS・LLM_TEMPERATURE を読む。推論を止められないモデルは既定の 80 トークンを推論で使い切って
 * 空の応答になるので、モデルに合わせて上げられるようにする。読めない値・範囲の外は既定値にして一度だけ警告する。
 */
export function llmGenerationParams(): { maxTokens: number; temperature: number } {
  const read = (name: string, pattern: RegExp, range: { default: number; min: number; max: number }): number => {
    const raw = process.env[name]?.trim() ?? '';
    if (raw === '') return range.default;
    const value = pattern.test(raw) ? Number(raw) : NaN;
    if (Number.isFinite(value) && value >= range.min && value <= range.max) return value;
    warnGenerationOnce(name, raw, range.default, range);
    return range.default;
  };
  return {
    maxTokens: read('LLM_MAX_TOKENS', /^\d+$/, LLM_GENERATION.maxTokens),
    temperature: read('LLM_TEMPERATURE', /^\d+(\.\d+)?$/, LLM_GENERATION.temperature),
  };
}
