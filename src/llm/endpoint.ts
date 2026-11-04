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
  // fetch は認証情報を含む URL を受け付けず、原因の分かりにくい例外になる。キーは LLM_API_KEY で渡す
  if (url.username || url.password) {
    return 'LLM のエンドポイントの URL に認証情報（user:pass@）を含めないでください。API キーは LLM_API_KEY に設定します';
  }
  // /chat/completions はこちらで付けるので、含めると /chat/completions/chat/completions になって 404 になる
  if (/\/chat\/completions\/*$/.test(url.pathname)) {
    return (
      'LLM のエンドポイントの末尾の /chat/completions は不要です' +
      `（${url.origin}${url.pathname.replace(/\/chat\/completions\/*$/, '')} のように指定してください）`
    );
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
