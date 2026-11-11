import { VERSION } from '../version.js';

/**
 * 外部（Spotify・LLM・ジャケ写の CDN）への fetch に付ける User-Agent。
 * 相手側のログで、どのアプリのどの版からの呼び出しかを切り分けられるようにする。
 * Node（undici）でも Workers でも、fetch の headers で指定できる。
 */
export const USER_AGENT = `spotify-embedded/${VERSION} (+https://github.com/Sh1n1230/SpotifyEmbedded)`;

/** init の headers に User-Agent を足す（呼び出し側が指定していればそれを残す）。 */
export function withUserAgent(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  if (!merged.has('User-Agent')) merged.set('User-Agent', USER_AGENT);
  return merged;
}
