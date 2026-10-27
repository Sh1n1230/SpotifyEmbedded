/**
 * LLM のエンドポイント URL の検査。API キーは `Authorization: Bearer` で送るので、
 * 平文の http で外へ出さない。ローカルのサーバー（Ollama など）を http で使うのは正当なので残す。
 *
 * npm run setup の入力時と、chatCompletion() の送信前の両方で使う。
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 送ってよい URL なら null、だめならその理由。 */
export function llmBaseUrlProblem(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return `LLM のエンドポイントが URL として読めません: ${baseUrl}`;
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:') {
    if (LOCAL_HOSTS.has(url.hostname)) return null;
    return (
      'API キーが平文で送られるため、https の URL を指定してください' +
      '（http が使えるのはローカルの localhost・127.0.0.1・[::1] だけです）'
    );
  }
  return `LLM のエンドポイントは https:// で始まる URL にしてください: ${baseUrl}`;
}

/** ローカルのサーバーか（setup で「このホストに API キーが送られます」を出すかの判断に使う）。 */
export function isLocalLlmEndpoint(baseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
