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

/**
 * 推論を無効にするための追加パラメータ。
 *
 * ムード文は1文を書くだけで推論を必要としない。にもかかわらず推論モデルは
 * 短い max_tokens を推論だけで使い切り、本文が空のまま finish_reason=length
 * で返してくることがある（Gemini で実際に completion_tokens=0 になる）。
 *
 * 無効化の指定はプロバイダごとに形が違い、対応していない相手に送ると 400 に
 * なるため、エンドポイントのホストで振り分ける。
 */
function noReasoningParams(baseUrl: string): Record<string, unknown> {
  // OpenRouter 独自形式。`reasoning_effort` は受け付けない。
  if (baseUrl.includes('openrouter.ai')) return { reasoning: { effort: 'none' } };
  // Gemini の OpenAI 互換層は OpenAI 標準の `reasoning_effort` を解釈する。
  if (baseUrl.includes('generativelanguage.googleapis.com')) {
    return { reasoning_effort: 'none' };
  }
  return {};
}

/** 応答テキストを返す。失敗時は原因が分かるメッセージを添えて throw。 */
export async function chatCompletion(params: ChatCompletionParams): Promise<string> {
  const url = `${params.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const send = async (): Promise<Response> => {
    try {
      return await fetch(url, {
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
          ...noReasoningParams(params.baseUrl),
        }),
        signal: AbortSignal.timeout(params.timeoutMs ?? 15000),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error(`LLMへのリクエストがタイムアウトしました (${url})`);
      }
      throw new Error(`LLMに接続できませんでした (${url}): ${(err as Error).message}`);
    }
  };

  let res = await send();

  // 5xx は相手側の一時的な混雑であることが多い（Gemini の 503 "high demand" など）。
  // 一度だけ間を置いて引き直す。それでも駄目ならムード文を諦める。
  if (res.status >= 500) {
    await new Promise((done) => setTimeout(done, 900));
    res = await send();
  }

  if (!res.ok) {
    throw new Error(`${describeStatus(res.status, params)} (${res.status})${await detail(res)}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text?.trim()) {
    // 推論モデルが max_tokens を推論だけで使い切ると、ここに来る。
    throw new Error(
      `LLMの応答が空でした（モデル: ${params.model}）。` +
        '推論モデルの場合、出力上限を推論で使い切っている可能性があります。'
    );
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
    case 503:
      return `モデル "${params.model}" が混雑しています。時間をおくか、軽いモデルに変えてください`;
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
