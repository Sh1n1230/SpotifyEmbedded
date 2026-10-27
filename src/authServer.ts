/**
 * `npm run auth` のエントリ。/auth/* を有効にして Node のサーバー（src/index.ts）を起動する。
 *
 * package.json に `ENABLE_AUTH_ROUTES=true tsx src/index.ts` と書くと POSIX のシェルの構文になり、
 * scripts を cmd.exe で実行する Windows では動かない。config.ts は遅延評価なので、
 * import より前に代入すれば効く。dotenv は既にある環境変数を上書きしないので、
 * 設定ファイルに ENABLE_AUTH_ROUTES=false があってもこちらが勝つ。
 */
process.env['ENABLE_AUTH_ROUTES'] = 'true';
await import('./index.js');
