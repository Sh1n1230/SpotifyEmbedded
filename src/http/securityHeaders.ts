/**
 * ライブAPIが付けるセキュリティヘッダー。
 *
 * Node 版は src/app.ts のミドルウェアがすべての応答に付ける。Workers 版では public/ が
 * Worker より先に Static Assets として配られるため、静的ファイルの分は public/_headers に
 * 同じ値を書いている（一致は spec で確かめる）。
 *
 * | 対象                  | 付けるもの |
 * |-----------------------|-----------|
 * | すべて                | X-Content-Type-Options・Referrer-Policy・Permissions-Policy、https なら HSTS |
 * | /embed 以外           | X-Frame-Options: DENY（/embed は他サイトの iframe に入るためのページ） |
 * | /embed・/badge.svg    | それぞれの CSP（src/routes/embed.ts） |
 * | デモ画面（/）         | DEMO_PAGE_CSP |
 */

/** カメラ・位置情報などは一切使わないので閉じる。 */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

/**
 * 1年。includeSubDomains は付けない（独自ドメインで運用する人の他のサブドメインまで縛るため）。
 * http の応答に付けてもブラウザは無視するが、ローカルの http 開発で紛らわしくならないよう
 * Node 版は https のときだけ付ける。
 */
export const HSTS = 'max-age=31536000';

/** デモ画面（public/index.html）。スクリプトは同一オリジンの demo.js だけ。 */
export const DEMO_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  'img-src https: data:',
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
