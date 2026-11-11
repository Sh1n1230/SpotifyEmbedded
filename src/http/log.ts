/**
 * ログに出す外部由来の文字列（曲名・ムード文・リクエストのパスなど）。改行と制御文字を空白に置き換えて1行に収める。
 * - 偽のログの行を差し込ませない（ログ注入）
 * - GitHub Actions は行頭の「::」をワークフローコマンドとして解釈するため、改行を含む曲名でコマンドを差し込めてしまう
 */
export function forLog(value: string): string {
  // eslint-disable-next-line no-control-regex -- 制御文字を取り除くため、意図して指定している
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ');
}
