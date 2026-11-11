/**
 * OpenAI Chat Completions 形式の最小クライアント。
 *
 * 専用SDKを使わないのは、OpenAI / OpenRouter / Gemini / ローカルのサーバーを
 * 同じコードで扱うため。必要なのは `POST {baseUrl}/chat/completions` ひとつ。
 */
import { discardBody } from '../http/body.js';
import { USER_AGENT } from '../http/userAgent.js';
import { llmBaseUrlProblem } from './endpoint.js';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatCompletionParams {
  baseUrl: string;
  /** null なら Authorization を付けない（キーの要らないローカルのサーバー） */
  apiKey: string | null;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { message?: string };
}

function extractContentText(content: unknown): string {
  const unsupportedContent = () =>
    new Error(
      'LLMの応答形式に対応していません（message.content は文字列または text 型 content parts の配列である必要があります）。'
    );

  if (typeof content === 'string') return content;
  // 推論モデルが出力上限を推論で使い切ると content は null か欠けて返る。
  // 形式の誤りではなく「空の応答」として呼び出し側の案内に回す。
  if (content === null || content === undefined) return '';
  if (!Array.isArray(content)) throw unsupportedContent();

  const textParts: string[] = [];
  for (const part of content as unknown[]) {
    if (
      typeof part !== 'object' ||
      part === null ||
      !('type' in part) ||
      typeof part.type !== 'string'
    ) {
      throw unsupportedContent();
    }
    if (part.type !== 'text') continue;
    if (!('text' in part) || typeof part.text !== 'string') throw unsupportedContent();
    textParts.push(part.text);
  }

  if (textParts.length === 0) throw unsupportedContent();
  return textParts.join('');
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
  if (isHost(baseUrl, 'openrouter.ai')) return { reasoning: { effort: 'none' } };
  // Gemini の OpenAI 互換層は OpenAI 標準の `reasoning_effort` を解釈する。
  if (isHost(baseUrl, 'generativelanguage.googleapis.com')) {
    return { reasoning_effort: 'none' };
  }
  return {};
}

/**
 * 出力の上限のパラメータ。OpenAI は `max_tokens` を非推奨にしており、推論モデル（o 系・gpt-5 系）は
 * 受け付けない（400）ため `max_completion_tokens` を送る。ほかのプロバイダは互換のため `max_tokens` のまま。
 */
function maxTokensParams(baseUrl: string, maxTokens: number): Record<string, unknown> {
  return isHost(baseUrl, 'api.openai.com') ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
}

/** URL のホストが domain かその下か。文字列の一部（パスなど）に含まれるだけでは一致させない。 */
function isHost(baseUrl: string, domain: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/** `{baseUrl}/chat/completions`。クエリ（?api-version= など）は保ったまま、パスにだけ足す。 */
export function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return url.toString();
}

/** 応答テキストを返す。失敗時は原因が分かるメッセージを添えて throw。 */
export async function chatCompletion(params: ChatCompletionParams): Promise<string> {
  // http のリモートには API キーを送らない（呼び出し側は LLM の失敗と同じくムード文なしに落ちる）
  const problem = llmBaseUrlProblem(params.baseUrl);
  if (problem) throw new Error(problem);

  const url = chatCompletionsUrl(params.baseUrl);
  const startedAt = Date.now();
  // 推論モデルなど、temperature を受け付けないモデルがある。400 で拒まれたら、外して一度だけ送り直す
  let includeTemperature = true;

  const send = async (): Promise<Response | 'timeout'> => {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          ...maxTokensParams(params.baseUrl, params.maxTokens ?? 160),
          ...(includeTemperature ? { temperature: params.temperature ?? 0.7 } : {}),
          ...noReasoningParams(params.baseUrl),
        }),
        signal: AbortSignal.timeout(params.timeoutMs ?? 15000),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';
      throw new Error(`LLMに接続できませんでした (${url}): ${(err as Error).message}`, {
        cause: err,
      });
    }
  };

  let res = await send();

  // 5xx とタイムアウトは相手側の一時的な混雑であることが多い（Gemini の
  // 503 "high demand" や、混雑時に応答が返ってこないケース）。
  // 一度だけ間を置いて引き直す。それでも駄目ならムード文を諦める。
  // 待ちを固定すると同時に失敗した isolate が同じ瞬間に引き直して混雑を強めるため、
  // 600〜1200ms の間でばらつかせる。
  if (res === 'timeout' || res.status >= 500) {
    if (res !== 'timeout') await discardBody(res);
    const delayMs = 600 + Math.floor(Math.random() * 601);
    await new Promise((done) => setTimeout(done, delayMs));
    res = await send();
  }
  if (res === 'timeout') throw new Error(`LLMへのリクエストがタイムアウトしました (${url})`);

  if (res.status === 400) {
    const message = await detail(res);
    if (/temperature/i.test(message)) {
      includeTemperature = false;
      res = await send();
      if (res === 'timeout') throw new Error(`LLMへのリクエストがタイムアウトしました (${url})`);
    } else {
      throw new Error(`${describeStatus(400, params)} (400)${message}`);
    }
  }

  if (!res.ok) {
    throw new Error(`${describeStatus(res.status, params)} (${res.status})${await detail(res)}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  logUsage(params.model, Date.now() - startedAt, data.usage);
  const content = data.choices?.[0]?.message?.content;
  const text = extractContentText(content);
  if (!text.trim()) {
    // 推論モデルが max_tokens を推論だけで使い切ると、ここに来る。
    throw new Error(
      `LLMの応答が空でした（モデル: ${params.model}）。` +
        '推論モデルの場合、出力上限を推論で使い切っている可能性があります。'
    );
  }

  // 途中で打ち切られた文（length）や、フィルタで止められた出力（content_filter など）は採らない。
  // finish_reason を返さない互換サーバーもあるので、無いときは今までどおり採る
  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason === 'length') {
    throw new Error(`LLMの応答が出力上限で途中で切れました（モデル: ${params.model}）。`);
  }
  if (typeof finishReason === 'string' && finishReason !== '' && finishReason !== 'stop') {
    throw new Error(
      `LLMの応答が完了しませんでした（finish_reason: ${finishReason.slice(0, 40)}、モデル: ${params.model}）。`
    );
  }

  return text;
}

/**
 * 呼び出しごとに、モデル・所要時間（再試行を含む）・トークン数を1行で残す。費用が想定より多いとき・応答が遅いときの
 * 手がかりにする。応答の中身（ムード文）は出さない。usage を返さない互換サーバーでは、トークン数を省く。
 */
function logUsage(model: string, durationMs: number, usage: ChatCompletionResponse['usage']): void {
  const tokens = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : null);
  const prompt = tokens(usage?.prompt_tokens);
  const completion = tokens(usage?.completion_tokens);
  console.log(
    `[llm] model=${model} duration_ms=${durationMs}` +
      (prompt !== null ? ` prompt_tokens=${prompt}` : '') +
      (completion !== null ? ` completion_tokens=${completion}` : '')
  );
}

/** よくある失敗は、次に何を直せばいいかまで書く。 */
function describeStatus(status: number, params: ChatCompletionParams): string {
  switch (status) {
    case 401:
    case 403:
      return 'LLMのAPIキーが拒否されました。LLM_API_KEY を確認してください';
    case 400:
      return `LLM がリクエストを受け付けませんでした。モデル "${params.model}" が LLM_BASE_URL の送り先で使えるかを確認してください`;
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
