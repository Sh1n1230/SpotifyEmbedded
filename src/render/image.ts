/**
 * ジャケ写を data URI に変換する。
 *
 * GitHub の camo プロキシは SVG 内の外部リソース参照（<image href="https://...">）を
 * 描画しない。README に貼れる SVG にするには、画像そのものを base64 で
 * 焼き込む必要がある。
 */
import { IMAGE_TIMEOUT_MS } from '../spotify/timeout.js';
import { discardBody } from '../http/body.js';

/** これを超える画像は埋め込まない（SVGが肥大化してレンダリングが不安定になる）。 */
const MAX_IMAGE_BYTES = 512 * 1024;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Spotify のジャケ写URLはパスのプレフィックスがサイズを表す。
 * 640px / 300px / 64px の3種が返るので、必要なサイズへ差し替える。
 * 未知の形式なら元のURLをそのまま使う。
 */
const SIZE_PREFIX: Record<number, string> = {
  640: 'ab67616d0000b273',
  300: 'ab67616d00001e02',
  64: 'ab67616d00004851',
};

const KNOWN_PREFIXES = Object.values(SIZE_PREFIX);

export function albumArtAtSize(url: string, size: 640 | 300 | 64): string {
  if (!url) return url;
  const target = SIZE_PREFIX[size];
  if (!target) return url;

  for (const prefix of KNOWN_PREFIXES) {
    if (url.includes(prefix)) return url.replace(prefix, target);
  }
  return url;
}

/** リダイレクトを辿る上限。Spotify の CDN は通常リダイレクトしない。 */
const MAX_REDIRECTS = 3;

/** 埋め込んでよい取得先か。https の Spotify の CDN（*.scdn.co）だけ。 */
function isAllowedImageUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname.endsWith('.scdn.co');
}

/**
 * 画像を取得して data URI にする。失敗したら null（呼び出し側は
 * プレースホルダを描く）。ネットワーク事情で生成全体を落とさない。
 *
 * GitHub の README に貼られる SVG に何を焼き込むかの境界なので、次をすべて満たすものだけを通す:
 * - https の *.scdn.co（リダイレクト先も同じ条件で確かめる。fetch に任せると最終的な取得先が検証されない）
 * - content-type が jpeg / png / webp / gif（image/svg+xml は通さない。SVG の中に別の SVG を埋め込まない）
 * - MAX_IMAGE_BYTES 以下。Content-Length で先に断り、無くても読みながら超えた時点で打ち切る
 */
export async function fetchImageDataUri(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    // 時間切れも下の catch で null（プレースホルダ）になる。リダイレクトも含めた全体の上限
    const res = await fetchAllowedImage(url, AbortSignal.timeout(IMAGE_TIMEOUT_MS));
    if (!res) return null;

    if (!res.ok) {
      console.warn(`[image] 取得に失敗しました (${res.status}): ${url}`);
      await discardBody(res);
      return null;
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!ALLOWED_TYPES.has(contentType)) {
      console.warn(`[image] 未対応の content-type です: ${contentType}`);
      await discardBody(res);
      return null;
    }

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      console.warn(`[image] サイズが大きすぎるのでスキップします: ${declared} bytes`);
      await discardBody(res);
      return null;
    }

    const buffer = await readAtMost(res, MAX_IMAGE_BYTES);
    if (!buffer) {
      console.warn(`[image] サイズが大きすぎるのでスキップします: ${MAX_IMAGE_BYTES} bytes を超えました`);
      return null;
    }

    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.warn('[image] 取得中にエラーが発生しました:', url, err);
    return null;
  }
}

/** 取得先を確かめながら、リダイレクトを自分で辿る。許可しない先なら null。 */
async function fetchAllowedImage(url: string, signal: AbortSignal): Promise<Response | null> {
  let target = url;
  for (let hops = 0; ; hops++) {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return null;
    }
    if (!isAllowedImageUrl(parsed)) {
      console.warn(`[image] 想定外の取得先なのでスキップします: ${parsed.protocol}//${parsed.hostname}`);
      return null;
    }

    const res = await fetch(parsed.href, { signal, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get('location');
    await discardBody(res);
    if (!location || hops >= MAX_REDIRECTS) {
      console.warn(`[image] リダイレクトを辿れません (${res.status}): ${parsed.href}`);
      return null;
    }
    target = new URL(location, parsed).href;
  }
}

/** 本文を最大 limit バイトまで読む。超えたら読むのをやめて null。 */
async function readAtMost(res: Response, limit: number): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
