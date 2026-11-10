/**
 * 動いている版。ライブAPIの /health と、静的モードの出力の generator に入る。
 *
 * package.json を実行時に読まないのは、Workers にファイルシステムが無く、ビルドの rootDir（src/）の外を
 * import できないため。package.json の version と一致することは spec で確かめている（リリースの手順で両方を上げる）。
 */
export const VERSION = '1.7.0';
