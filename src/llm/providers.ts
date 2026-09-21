/**
 * LLMプロバイダのプリセット。
 *
 * このプロジェクトが「対応」しているのは特定のサービスではなく、
 * OpenAI の Chat Completions 形式（`POST {baseUrl}/chat/completions`）
 * そのものである。下の一覧は、そのURLとモデル名を毎回調べなくて済むよう
 * 用意した入力補助にすぎない。ここに無いサービスでも、URLさえ分かれば
 * 「その他」から同じように使える。
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
    label: 'Groq（推奨）',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    signupUrl: 'https://console.groq.com/keys',
    note: '無料枠あり・クレジットカード不要',
  },
  {
    id: 'gemini',
    // Gemini は OpenAI 互換の口を `/v1beta/openai` に持っている。
    // 素の `/v1beta` や `/v1beta/interactions` ではないので注意。
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.1-flash-lite',
    signupUrl: 'https://aistudio.google.com/apikey',
    note: '無料枠あり',
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
    id: 'custom',
    label: 'その他（OpenAI互換のエンドポイントURLを直接入力）',
    baseUrl: '',
    defaultModel: '',
    signupUrl: '',
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
