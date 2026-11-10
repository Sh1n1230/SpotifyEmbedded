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
 * | 埋め込まれるパス      | Cross-Origin-Resource-Policy: cross-origin（EMBEDDABLE_PATHS） |
 * | /embed.js             | EMBED_SCRIPT_CACHE_CONTROL |
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

/**
 * 他サイトに埋め込まれるためのパス。Cross-Origin-Embedder-Policy: require-corp のサイトは、他オリジンの
 * 画像・iframe・スクリプトに Cross-Origin-Resource-Policy: cross-origin が無いと読み込まない。
 * それ以外のパス（デモ画面・/health など）には付けない。
 */
export const EMBEDDABLE_PATHS: readonly string[] = ['/badge.svg', '/embed', '/embed.js', '/api/now-playing'];
export const CROSS_ORIGIN_RESOURCE_POLICY = 'cross-origin';

/**
 * embed.js は他人のサイトに貼られるので、修正が届くまでの時間を実行環境まかせにしない。
 * 5分だけ保存させ、過ぎたら必ず問い合わせさせる。Workers 版は public/_headers に同じ値を書く。
 */
export const EMBED_SCRIPT_CACHE_CONTROL = 'public, max-age=300, must-revalidate';
