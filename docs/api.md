# API の詳細

[README の APIリファレンス](../README.md#apiリファレンス)の補足です。応答の形そのものは [JSON Schema](../schema/) が正です。

## `GET /api/now-playing`

- JSON（既定）と YAML（`?format=yaml` または `Accept: application/yaml`）を返します。エラー応答は常に JSON です
- YAML は `application/yaml`（RFC 9512）で返すので、多くのブラウザでは表示されずにダウンロードになります。中身は `curl 'https://your-api.example.com/api/now-playing?format=yaml'` で確かめられます
- 成功の応答は `Cache-Control: public, max-age=0, must-revalidate`、エラーの応答は `Cache-Control: no-store` です
- 時刻（`fetched_at`・`mood.generated_at`）はすべて UTC の ISO 8601（`Z` 付き）です

### フィールドの補足

| フィールド | 補足 |
|---|---|
| `progress_ms` | `fetched_at` の時点の再生位置。応答はキャッシュされるので（既定30秒、`NOW_PLAYING_CACHE_SECONDS`）、今の位置は `progress_ms +（現在時刻 − fetched_at）` で見積もります。一時停止やシークは反映されません。再生していなければ `null` |
| `track.explicit` | Spotify の explicit。v1.8.0 以前の `snapshot.json` から引き継いだ曲は `false` |
| `track.popularity`・`track.preview_url` | 2024年11月以降に作成された Spotify アプリでは API が返さないため、常に `null`（キーは残ります） |
| `mood` | LLM が未設定のとき、生成に失敗したとき、曲が変わった直後で生成が5秒以内に終わらなかったときは `null` |
| `mood.model` | 生成に使った LLM のモデル名。v1.8.0 以前に作られた文は `null` |

`progress_ms`・`explicit`・`model` は、カードの表示には使いません。

ポッドキャストのエピソードとローカルファイルは楽曲として扱わず、再生していない状態（`is_playing: false`・`track: null`）と同じ応答になります。

## エラー応答

本文は `{ "error": "<人向けの文>", "code": "<機械向けのコード>" }` です。`error` の文は変わることがあるので、分岐には `code` を使ってください。

| ステータス | `code` | 追加のキー・ヘッダー | 意味 |
|---|---|---|---|
| 429 | `rate_limited` | `Retry-After` | この API のレート制限。送る頻度を下げてください |
| 503 | `spotify_rate_limited` | `retry_after: N`・`Retry-After` | サーバーが Spotify のレート制限に達した。利用者が送りすぎたわけではないので 429 ではなく 503 です。`Retry-After` の間、サーバーは Spotify を呼びません |
| 503 | `not_configured` | — | サーバーに必須の設定（Secrets）が無い |
| 502 | `spotify_auth_failed` | — | refresh_token の失効など。設定を直すまで、サーバーはトークンの更新を再試行しません |
| 502 | `spotify_error` | `spotify_status: N` | Spotify の失敗 |
| 502 | `spotify_unreachable` | — | Spotify に接続できない |
| 504 | `spotify_timeout` | — | Spotify の時間切れ |
| 404 | `not_found` | — | 未定義のパス |
| 400 | `bad_request` | — | リクエストの誤り |
| 500 | `internal_error` | — | 想定外のエラー |

### `/badge.svg` と `/embed` の失敗

この2つは JSON を返せないので、失敗しても 200 でカード（「取得できませんでした」）を返し、理由を `X-Spotify-Embedded-Error` ヘッダーで示します。

| 値 | 意味 |
|---|---|
| `rate_limited` | この API のレート制限を超えた |
| `spotify_unavailable` | それ以外のすべて（Spotify から取得できなかった） |

## レート制限

接続元 IP ごとに 60 秒あたり 100 リクエストが目安です（`/health` は対象外。IPv6 は /64 単位で数えます）。Workers 版は拠点ごとの近似なので、厳密な上限ではありません。

Node 版は残りの回数をヘッダーで返します（Workers 版は付けません）。

- `RateLimit-Policy: "default";q=100;w=60` と `RateLimit: "default";r=42;t=37`（[draft-ietf-httpapi-ratelimit-headers](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) の現行の形）
- `RateLimit-Limit`・`RateLimit-Remaining`・`RateLimit-Reset`（draft-03 以前の形。移行のために併記）

これらと `Retry-After`・`X-Spotify-Embedded-Error` は `Access-Control-Expose-Headers` に含めているので、他のオリジンの JavaScript からも読めます。

## 埋め込み用エンドポイント

| パス | クエリパラメータ |
|---|---|
| `GET /embed` | `theme`（`dark` / `light` / `auto`）・`transparent`・`refresh`（秒、10〜3600、既定30）・`max_width`（px、240〜1920、既定460。`full` で親の幅いっぱい） |
| `GET /badge.svg` | `theme`（`dark` / `light`）。背景は透過 |
| `GET /embed.js` | — |
| `GET /health` | —。`{ "status": "ok", "version": "<動いている版>" }` を返す |

- `/badge.svg`・`/embed`・`/embed.js`・`/api/now-playing` は `Cross-Origin-Resource-Policy: cross-origin` を返すので、`Cross-Origin-Embedder-Policy: require-corp` を有効にしたサイトにも埋め込めます
- `/embed.js` は `Cache-Control: public, max-age=300, must-revalidate` で配ります（修正は5分以内に届きます）
- `X-Frame-Options` は `/embed` 以外すべて `DENY` です
- ジャケ写は Spotify の CDN（`*.scdn.co`・`*.spotifycdn.com`）からだけ読み込みます

## ランキング（`top-tracks.json`、静的モードのみ）

ライブAPIにランキングのエンドポイントはありません。静的モードが `top-tracks.json` / `.yaml` として出力します。

- 各曲には `rank` と `genres` が付きます。`genres` は、2024年11月以降に作成された Spotify アプリでは取得できないため空配列になります
- `mood` はランキング全体のムード文です（LLM が未設定なら `null`）。上位10曲の顔ぶれが大きく変わったときだけ作り直すので、`mood.generated_at` は `fetched_at` より前の時刻になります（[設計メモ](../README.md#ランキングのムード文を毎回作らない理由)）

## README の設定表に無い環境変数

| 変数名 | 説明 |
|---|---|
| `NODE_ENV` | `production` で本番相当として扱う。今は、`CORS_ORIGIN` が `*` のままなら Node 版が起動時に警告することにだけ使う（Docker の既定は `production`） |
