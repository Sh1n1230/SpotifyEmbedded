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
import { isLocalLlmEndpoint } from './endpoint.js';
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
