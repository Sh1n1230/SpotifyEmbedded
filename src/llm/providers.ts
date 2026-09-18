/**
 * LLMプロバイダのプリセット。
 *
 * どれも OpenAI の Chat Completions 形式（`POST {baseUrl}/chat/completions`）を
 * 話すので、コード側はエンドポイントとモデル名が違うだけ。Groq も OpenAI 互換の
 * エンドポイントを公開しているため、専用SDKは不要になった。
 *
 * ここに無いサービスや、Ollama / LM Studio のようなローカルのサーバーも、
 * LLM_BASE_URL を指定すればそのまま使える。
 */

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  /** APIキーを発行するページ */
  signupUrl: string;
  note?: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    signupUrl: 'https://console.groq.com/keys',
    note: '無料枠あり・クレジットカード不要',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    signupUrl: 'https://platform.openai.com/api-keys',
    note: '従量課金',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    signupUrl: 'https://openrouter.ai/keys',
    note: '1つのキーで多数のモデルを切り替えられる',
  },
  {
    id: 'custom',
    label: 'その他（OpenAI互換のエンドポイント）',
    baseUrl: '',
    defaultModel: '',
    signupUrl: '',
    note: 'Ollama や LM Studio などローカルのサーバーも指定できる',
  },
];

/** プリセットが無い場合の既定。Groq は無料で始められるため。 */
export const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export function findProvider(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** baseUrl からプリセットを逆引きする（表示用）。 */
export function providerLabelForBaseUrl(baseUrl: string): string {
  const match = PROVIDERS.find((provider) => provider.baseUrl && baseUrl.startsWith(provider.baseUrl));
  return match ? match.label : baseUrl;
}
