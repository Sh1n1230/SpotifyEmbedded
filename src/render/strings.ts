/**
 * カード・ページの固定の文言。SVG（card.ts・ranking.ts）と iframe 用ページ（page.ts。ライブ更新のスクリプトにも
 * ここから埋め込む）はここから読む。1か所だけ直して表示が食い違わないよう、直書きしない。
 *
 * public/embed.js はビルドを通さない静的ファイルなので import できず、同じ文言を持っている。
 * 一致は spec（browser.test.ts）で確かめている。
 */
export const STRINGS = {
  /** 見出し（英大文字のラベル） */
  nowPlaying: 'NOW PLAYING',
  lastPlayed: 'LAST PLAYED',
  nothingPlaying: 'NOTHING PLAYING',
  unavailableLabel: 'UNAVAILABLE',
  /** 曲が無いときの本文 */
  idle: '再生していません',
  unavailable: '取得できませんでした',
  /** 読み上げ（aria-label）の先頭と末尾 */
  speechPlaying: '再生中',
  speechLastPlayed: '最後に再生',
  openInSpotify: '（Spotifyで開く）',
  /** 「2026-09-21 時点」「再生中（9/21 21:00 時点）」 */
  asOf: '時点',
  /** タブのタイトルの先頭 */
  titlePlaying: 'Now Playing',
  titleLastPlayed: 'Last Played',
  noArt: 'no art',
  noData: 'データがありません',
} as const;

/**
 * ライブ更新の取得がこの回数続けて失敗したら、再生中の表示をやめて「取得できなかった」ことを見せる
 * （/embed のライブ更新と public/embed.js で同じ値）。失敗が続くと取得の間隔は最大15分まで伸びるので、
 * そのままだと、とうに再生を終えた曲が「NOW PLAYING」のまま残り続ける。
 */
export const STALE_AFTER_FAILURES = 3;
