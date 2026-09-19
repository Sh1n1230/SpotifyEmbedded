/**
 * ジャケ写を data URI に変換する。
 *
 * GitHub の camo プロキシは SVG 内の外部リソース参照（<image href="https://...">）を
 * 描画しない。README に貼れる SVG にするには、画像そのものを base64 で
 * 焼き込む必要がある。
 */

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

/**
 * 画像を取得して data URI にする。失敗したら null（呼び出し側は
 * プレースホルダを描く）。ネットワーク事情で生成全体を落とさない。
 */
export async function fetchImageDataUri(url: string): Promise<string | null> {
  if (!url) return null;

  // 埋め込むのは Spotify のCDNから取得したものだけに限る
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.scdn.co')) {
    console.warn(`[image] 想定外のホストなのでスキップします: ${parsed.hostname}`);
    return null;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[image] 取得に失敗しました (${res.status}): ${url}`);
      return null;
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!ALLOWED_TYPES.has(contentType)) {
      console.warn(`[image] 未対応の content-type です: ${contentType}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      console.warn(`[image] サイズが大きすぎるのでスキップします: ${buffer.byteLength} bytes`);
      return null;
    }

    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.warn(`[image] 取得中にエラーが発生しました: ${url}`, err);
    return null;
  }
}
