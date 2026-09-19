/**
 * OpenAI Chat Completions 形式の最小クライアント。
 *
 * 専用SDKを使わないのは、OpenAI / OpenRouter / Groq / ローカルのサーバーを
 * 同じコードで扱うため。必要なのは `POST {baseUrl}/chat/completions` ひとつ。
 */

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatCompletionParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** 応答テキストを返す。失敗時は原因が分かるメッセージを添えて throw。 */
export async function chatCompletion(params: ChatCompletionParams): Promise<string> {
  const url = `${params.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.maxTokens ?? 160,
        temperature: params.temperature ?? 0.7,
        // OpenRouterの推論モデルは短い上限を推論だけで使い切り、
        // 本文を返さないことがある。ムード文は推論を必要としない。
        ...(params.baseUrl.includes('openrouter.ai')
          ? { reasoning: { effort: 'none' } }
          : {}),
      }),
      signal: AbortSignal.timeout(params.timeoutMs ?? 15000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`LLMへのリクエストがタイムアウトしました (${url})`);
    }
    throw new Error(`LLMに接続できませんでした (${url}): ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new Error(`${describeStatus(res.status, params)} (${res.status})${await detail(res)}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    throw new Error(`LLMの応答が空でした（モデル: ${params.model}）`);
  }

  return text;
}

/** よくある失敗は、次に何を直せばいいかまで書く。 */
function describeStatus(status: number, params: ChatCompletionParams): string {
  switch (status) {
    case 401:
    case 403:
      return 'LLMのAPIキーが拒否されました。LLM_API_KEY を確認してください';
    case 404:
      return `モデル "${params.model}" が見つかりません。LLM_MODEL と LLM_BASE_URL の組み合わせを確認してください`;
    case 429:
      return 'LLMのレート制限に達しました';
    default:
      return 'LLMの呼び出しに失敗しました';
  }
}

async function detail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ChatCompletionResponse;
    const message = body.error?.message;
    return message ? `: ${message}` : '';
  } catch {
    return '';
  }
}
