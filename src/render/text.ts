/**
 * SVG用のテキスト処理。
 *
 * SVG の <text> は自動折り返しをしない。<foreignObject> を使えば HTML の
 * 折り返しが効くが、GitHub の camo プロキシは foreignObject を描画しない
 * ため README で使えない。そこで文字幅を自前で見積もって改行位置を決める。
 */

/** 曲名やアーティスト名は外部由来なので、SVGに埋める前に必ず通す。 */
export function escapeXml(value: string): string {
  return value
    // XMLで表現できない制御文字を先に落とす（タブ・改行も1文字扱いにする）
    // eslint-disable-next-line no-control-regex -- XML で使えない制御文字を取り除くため、意図して指定している
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // XML の文字として不正な U+FFFE / U+FFFF と、対になっていないサロゲートも落とす
    .replace(/[\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&apos;';
      }
    });
}

/**
 * 書記素クラスタ（見た目の1文字）に分ける。絵文字の ZWJ シーケンス・国旗・肌の色の修飾子・
 * 結合文字は複数のコードポイントで1文字になるので、コードポイント単位で数えたり切ったりすると
 * 幅を見誤り、途中で切れて別の文字に化ける。Node 22 と Cloudflare Workers の両方で使える。
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
}

/**
 * 文字幅を em 単位で見積もる。
 * 全角（CJK・かな・全角記号・絵文字）を 1em、それ以外を 0.5em として扱う。
 * 正確な字送りはフォント依存なので、あくまで折り返し判定用の近似。
 */
export function visualWidth(text: string): number {
  let width = 0;
  for (const cluster of graphemes(text)) width += clusterWidth(cluster);
  return width;
}

/**
 * 1文字（書記素クラスタ）の幅。先頭のコードポイントで判定し、絵文字として表示される並び
 * （ZWJ シーケンス・異体字セレクタ U+FE0F・キーキャップ U+20E3）は全角1つ分とする。
 */
function clusterWidth(cluster: string): number {
  if (isFullWidth(cluster)) return 1;
  return /\u200d|\ufe0f|\u20e3/.test(cluster) ? 1 : 0.5;
}

/** 既定で絵文字として表示される文字（⚡ ☕ 🫠 国旗の地域指示子など）。# * 0-9 は含まない。 */
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}/u;

/** 先頭のコードポイントが全角（East Asian Width の W / F）か。 */
function isFullWidth(text: string): boolean {
  const code = text.codePointAt(0);
  if (code === undefined) return false;
  return (
    (code >= 0x1100 && code <= 0x115f) || // ハングル字母
    (code >= 0x2e80 && code <= 0x303e) || // CJK部首・記号
    (code >= 0x3041 && code <= 0x33ff) || // かな・カタカナ・CJK互換
    (code >= 0x3400 && code <= 0x4dbf) || // CJK拡張A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK統合漢字
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) || // ハングル音節
    (code >= 0xf900 && code <= 0xfaff) || // CJK互換漢字
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || // 全角英数・記号
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff) || // 絵文字
    (code >= 0x1fa70 && code <= 0x1faff) || // 絵文字（Symbols and Pictographs Extended-A）
    (code >= 0x20000 && code <= 0x2fffd) || // CJK拡張B〜（人名・地名の異体字など）
    (code >= 0x30000 && code <= 0x3fffd) ||
    EMOJI_PRESENTATION.test(text)
  );
}

/** 指定幅(em)に収まるよう末尾を省略する。文字（書記素クラスタ）の途中では切らない。 */
export function truncateToWidth(text: string, maxWidthEm: number): string {
  if (visualWidth(text) <= maxWidthEm) return text;

  const ellipsis = '…';
  const [head] = splitAtWidth(text, maxWidthEm - visualWidth(ellipsis));
  return head + ellipsis;
}

/** 幅 maxWidthEm に収まる先頭と、残りに分ける。文字（書記素クラスタ）の途中では切らない。 */
function splitAtWidth(text: string, maxWidthEm: number): [string, string] {
  const clusters = graphemes(text);
  let width = 0;
  let i = 0;
  for (; i < clusters.length; i++) {
    const next = width + clusterWidth(clusters[i] ?? '');
    if (next > maxWidthEm) break;
    width = next;
  }
  return [clusters.slice(0, i).join(''), clusters.slice(i).join('')];
}

/**
 * 指定幅(em)で折り返して行の配列を返す。
 * 行数が maxLines を超える場合は最終行を省略記号で締める。
 *
 * 日本語は単語境界が無いため、半角語は単語単位・全角文字は1文字単位で折る。
 * 1語だけで幅を超える半角の語（URL 風の曲名・_ でつないだリミックス名など）は、
 * CSS の overflow-wrap: anywhere と同じく文字単位で割る（SVG にはクリップが無く、枠からはみ出すため）。
 */
export function wrapToWidth(text: string, maxWidthEm: number, maxLines: number): string[] {
  const all = wrapUnbounded(text, maxWidthEm);
  if (all.length <= maxLines) return all;

  // 収まらない分は最終行にまとめ、省略記号で締める
  const kept = all.slice(0, maxLines);
  kept[maxLines - 1] = truncateToWidth(all.slice(maxLines - 1).join(''), maxWidthEm);
  return kept;
}

/** 半角の文字（ラテン文字まで）か。半角の連続は途中で割らない1語として扱う。 */
function isHalfWidthWordChar(cluster: string): boolean {
  const code = cluster.codePointAt(0) ?? 0;
  return code <= 0x024f && clusterWidth(cluster) === 0.5;
}

/**
 * 折り返しの単位に分ける。半角の連続（英単語・数字）はひとかたまりにし、空白の直後で区切る。
 * 全角文字は1文字ずつ。どちらも書記素クラスタの途中では切らない。
 */
function wrapPieces(text: string): string[] {
  const pieces: string[] = [];
  let word = '';
  for (const cluster of graphemes(text)) {
    if (isHalfWidthWordChar(cluster)) {
      word += cluster;
      if (cluster === ' ') {
        pieces.push(word);
        word = '';
      }
      continue;
    }
    if (word) pieces.push(word);
    word = '';
    pieces.push(cluster);
  }
  if (word) pieces.push(word);
  return pieces;
}

function wrapUnbounded(text: string, maxWidthEm: number): string[] {
  const lines: string[] = [];
  let current = '';

  for (const piece of wrapPieces(text)) {
    if (current !== '' && visualWidth(current + piece) > maxWidthEm) {
      lines.push(current.trimEnd());
      current = piece.trimStart();
    } else {
      current += piece;
    }

    // 1語だけで幅を超えるなら、収まるところで行を確定して残りを続ける
    while (visualWidth(current.trimEnd()) > maxWidthEm) {
      let [line, rest] = splitAtWidth(current, maxWidthEm);
      if (line === '') {
        // 1文字すら入らない幅でも止まらないよう、最低1文字は進める
        const first = graphemes(current)[0] ?? '';
        [line, rest] = [first, current.slice(first.length)];
      }
      lines.push(line.trimEnd());
      current = rest.trimStart();
    }
  }

  if (current.trimEnd() !== '') lines.push(current.trimEnd());
  return lines;
}
