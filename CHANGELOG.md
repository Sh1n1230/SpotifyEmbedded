# 変更履歴

利用者から見た変更を版ごとに記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
版の付け方は [セマンティック バージョニング](https://semver.org/lang/ja/) に従います。
**アップグレード時に対応が要る変更**は各版の先頭に書きます。

リリースのタグを push すると、`release.yml` がこのファイルにその版の見出し（`## [x.y.z]`）があるかを確かめます。

## [Unreleased]

## [1.8.0] - 2026-11-11

### アップグレード時に確かめること

- Spotify のレート制限に達したとき、`/api/now-playing` は 429 ではなく **503**（`Retry-After` つき、`code: "spotify_rate_limited"`）を返します。429 は、このAPI自身のレート制限（利用者の送りすぎ）だけになります。ステータスで分岐している利用側は確かめてください
- エラーの JSON に `code` が加わりました（`{ "error": "...", "code": "spotify_timeout" }`）。本文を完全一致で比べている利用側は、`code` で分岐するようにしてください。必須の設定が無いときは 500 ではなく 503（`code: "not_configured"`）を返します
- `/health` の応答に `version` が加わりました（`{ "status": "ok", "version": "1.8.0" }`）
- `generate` は、`--count`（と新しい `--page-count`）が `--limit` を超える指定をエラーにします（これまでは警告を出して続行していました）
- 静的モードの `index.html` に `noindex` が入り、`robots.txt`（`Disallow: /`）を書き出すようになりました。検索エンジンに載せてよい場合は `generate --index` を付けます
- `snapshot.json` を GitHub Pages に公開しなくなりました（`spotify-data` ブランチには今までどおりあります）。Pages の URL から読んでいた場合は、`last-played.json` などの公開のファイルを使ってください
- 静的モードの再生中のカードの見出しが `NOW PLAYING · 10/16 21:04`（観測した時刻つき、日本時間）になりました。年が違う曲には年が付きます
- ムード文の保存のキーにモデル名とプロンプトの版が入りました。アップグレード直後は、保存済みの文（Workers KV・メモリ）を使わずに1回ずつ作り直します（古いキーは24時間で消えます）
- `LLM_BASE_URL` が `http://` のリモートなど送れない値のときは、曲ごとにエラーを出さず、LLM 未設定と同じく動きます（起動時・最初のリクエスト・`generate` の冒頭で一度だけ案内します）
- `/embed`・デモ画面・静的モードの `index.html` の CSP の `img-src` を、Spotify の CDN（`*.scdn.co`・`*.spotifycdn.com`）に絞りました
- npm パッケージから `main` を外しました（ライブラリとしての入口はありません。`import 'spotify-embedded'` はできなくなります。CLI は今までどおりです）
- Node 版は、拾われなかった例外・Promise の拒否で、原因を1行で出して終了します（再起動は Docker などの実行環境に任せます）
- `wrangler.jsonc` の `compatibility_date` を 2026-10-01 に上げました。フォークで `wrangler.jsonc` を変えている場合は取り込みのときに確かめてください
- `LLM_BASE_URL` を設定せずに `OPENAI_API_KEY`・`OPENROUTER_API_KEY`・`GROQ_API_KEY` だけを設定していた場合、キーの送り先がそのサービスになります（これまでは既定の Gemini に送っていました）。プリセットに無い送り先（Groq・OpenRouter・ローカルなど）では `LLM_MODEL` が必須になり、無いとムード文なしで動き、起動時に案内します
- `PORT` は 1〜65535 の整数だけを受け付けます（`3000abc` を 3000 として読まず、`0` も受け付けません）
- `CORS_ORIGIN` の、パス付きなどオリジンとして読めない値は使われません。`*` とほかのオリジンを混ぜると `*` は無視されます（起動時に警告します）
- `npm run auth` は既定でループバック（127.0.0.1）だけで待ち受けます。`HOST` 環境変数で待ち受けるホストを選べます

### 追加

- `/embed?theme=auto`・`embed.js` の `data-theme="auto"`（閲覧者の OS のダーク・ライトの設定に合わせる）
- `/embed?max_width=`・`embed.js` の `data-max-width`（カードの最大幅。`full` で親の幅いっぱい）
- 公開スキーマの JSON Schema（`schema/now-playing.schema.json`・`top-tracks.schema.json`・`last-played.schema.json`）
- `generate --page-count`（iframe 用ページのランキングだけ別の件数にする）・`--refresh-ranking-mood`・`--index`。値は `--out=dir` の形でも渡せる
- リポジトリの Variables `RANKING_RANGE`・`RANKING_COUNT` で、定期実行のランキングの期間と件数を変えられる
- 環境変数 `NOW_PLAYING_CACHE_SECONDS`（ライブAPIのキャッシュの秒数）・`LLM_MAX_TOKENS`・`LLM_TEMPERATURE`
- `npm run setup` で Groq・OpenRouter をプリセットから選べる。設定済みの Spotify の Client ID / Secret を入れ替えられる
- 埋め込み用のパスに `Cross-Origin-Resource-Policy: cross-origin`（COEP を有効にしたサイトにも埋め込める）
- `RateLimit-Policy`・`RateLimit` ヘッダー（現行の草案の形。これまでの3つのヘッダーも併記）と、`Access-Control-Expose-Headers`
- `/api/now-playing` の `Cache-Control`（成功は `public, max-age=0, must-revalidate`、エラーは `no-store`）、`/embed.js` の `Cache-Control`（5分）
- 外部（Spotify・LLM・ジャケ写）へのリクエストに `User-Agent: spotify-embedded/<版>` を付ける
- LLM の呼び出しごとの、モデル・所要時間・トークン数のログ。Node 版のアクセスログ（パス・ステータス・所要時間。IP アドレスは出さない）
- Release に SBOM（`sbom.spdx.json`）と、アーカイブの artifact attestation（`gh attestation verify` で確かめられる）を付ける。`v1.2.3-rc.1` のようなタグはプレリリースとして作る
- 静的モードの `index.html` に description とファビコン
- SVG カードと `embed.js` のカードに `lang="ja"`（英語のページに貼っても日本語として読み上げられる）
- Node 版・Docker・Workers の例外のスタックが、ソースマップで `src/*.ts` の行を指す
- `HOST` 環境変数（Node 版の待ち受けるホスト）
- ローカルの LLM（Ollama など）では `LLM_API_KEY` が無くてもムード文を作れる
- `TRUSTED_PROXY_HEADER=forwarded`（RFC 7239）に対応
- 静的モードの README に、`--theme` ごとの出力ファイルの表
- `spotify-embedded --version`（`-v`・`version`）

### 変更

- ライブAPIは、ムード文の生成を最大5秒だけ待つ。間に合わなければ `mood: null` で応答し、次の取得から載せる（遅い LLM のために曲情報や画像を遅らせない）
- Spotify の 429 を受けたら、`Retry-After` の間は Spotify を呼ばない。`invalid_grant`・`invalid_client` の後は、認証情報が変わるまでトークンの更新を再試行しない
- 認証情報の前後の空白・改行を取り除いて読む（貼り付けで付いた改行で `invalid_client` にならない）
- `/embed`・`embed.js` は、取得の失敗が3回続いたら「UNAVAILABLE」の表示に切り替える（前の曲を NOW PLAYING のまま出し続けない）
- 静的モードは、ランキングの取得だけが失敗した回も再生状況を更新する（ランキングのファイルは前回のまま残す）
- 静的モードは、前回と同じ曲を再生中なら前回のムード文を使う（LLM を呼ばず、文も実行ごとに変わらない）。中身の同じファイルは書き直さない
- ランキングのムード文の記録を、作らない回（`--no-mood`・LLM 未設定・上位曲が0件）でも消さない
- ランキング SVG のジャケ写は、10件までなら 300px 版を焼き込む（高解像度の画面でぼやけない）。iframe 用ページのランキングは `srcset` で選ばせる
- 再生中インジケータの動きを SVG と HTML で揃え、`transform` で動かす
- `npm run setup` と `/auth/login` は、毎回 Spotify の承認画面を出す（別のアカウントに切り替えられる）。完了時に Workers の Secrets の更新を案内する
- 認可コードの交換の失敗を、Spotify の `error`（`invalid_client`・`invalid_grant` など）ごとに案内する
- CORS のプリフライトで許可するメソッドを `GET`・`HEAD`・`OPTIONS` だけにする
- Workers では、進行中の取得の Promise をリクエストの間で共有しない。KV への書き込みは `waitUntil` に預けて応答を待たせない。`CORS_ORIGIN` が `*` のときの案内は、Workers では警告ではなく情報として出す
- Docker の `HEALTHCHECK` は Node を起動せず `wget` を使う
- `GOOGLE_API_KEY` を LLM のキーとして使うときは、起動時にその旨を知らせる
- ムード文のキャッシュが満杯のときは、最も長く読まれていない曲のものを捨てて入れる（満杯の後の曲を毎回 LLM で作り直していた）
- OpenAI には `max_completion_tokens` を送り、`temperature` を受け付けないモデルでは外して送り直す（推論モデルでもムード文が出る）
- ライブ更新（/embed・embed.js・デモ画面）は、429・503 の `Retry-After` の間は取得しない（タブを隠して戻したときも含む）
- 半角の文字幅を字の形で見積もる（大文字の多い曲名が SVG の右端からはみ出さない）
- Node 版でも静的ファイルをレート制限に数えない
- `update-spotify.yml` の定期実行を毎時 7 分・37 分にずらす
- `ENABLE_AUTH_ROUTES` は `true`・`1`・`yes`・`on`（大文字・小文字と前後の空白は問わない）で有効になる。読めない値は無効のまま警告を出す
- 未定義のパスは JSON の 404 を返す
- ローカルの LLM として http で使えるホストに、127.0.0.0/8 と `*.localhost` を加える

### 修正

- 2026年2月の Web API の変更で `GET /artists` が削除された環境で、ジャンルの取得を毎回試して失敗し続けることがあった（404・410 でも以降は呼ばない）
- LLM の応答が出力の上限で途中で切れていても（`finish_reason: "length"`）、そのままムード文にしていた
- アーティストが空の曲で、カードに空の行が出て、読み上げが「曲名 / 」で終わっていた
- Workers で Secrets が欠けていると、理由の分からない 500 を返し続けていた
- Windows の Node 版で、`/embed.js` の `Cache-Control` が付かない経路があった（ファイルのパスの区切りで判定していた）
- `update-spotify.yml` は、`spotify-data` ブランチに `snapshot.json` が無いときに空のファイルを残していた（読み込みの警告が出て、`refresh_ranking_mood` を付けた手動実行は失敗していた）
- 壊れた `data/auth.json` の読み込みの失敗で、ファイルの中身の一部（秘密情報の断片）がログに出ることがあった
- `npm run setup` の接続確認を本番と同じプロンプトと検査にする（形式で捨てられるモデルを、接続の失敗と分けて知らせる）。LLM の番号の入力は `1abc` などを聞き直す
- `generate` は足りない設定をまとめて知らせる。`DEBUG=spotify-embedded` でスタックトレースを出す
- `setup --help` で対話が始まっていた。知らないオプションは終了コード 1 で知らせる
- ライブAPIだけを使うフォークで、`update-spotify.yml` が Secrets 未設定のまま失敗し続けていた（省略して通知だけ出す）
- `npm run generate -- --help` と `-h` で使い方を表示し、正常終了するようにした
- ルートが返す 400 などの HTTP のエラーが、500 として返っていた
- レート制限で、先頭に 0 の付いた IPv4 アドレスを別のクライアントとして数えていた
- Spotify の応答の本文の読み取りの途中の時間切れは 504、接続できないときは 502、JSON でない応答は 502 を返す（これまでは 500）。トークン更新の 429・5xx も同じく扱う
- トークン更新の応答に `expires_in` が無いと、以降のすべてのリクエストでトークンを取り直していた
- 本文の無い 200・202 の currently-playing で 500 になっていた
- `LLM_BASE_URL` のクエリ（`?api-version=`）を保ち、末尾の `/chat/completions`・認証情報を含む URL は原因を示して拒む
- `npm run auth` を localhost で開くと Invalid state になっていた。Client ID / Secret が無いときは設定の案内を出す
- `npm run setup`: 入力が端末でないと黙って終わっていた・state の合わないリクエスト1件で失敗していた・`export KEY=` の行を見つけられなかった・`#` を含む値が切れていた・フォークで Secrets の登録先がずれていた・削除の失敗を見逃していた
- `.env.example` の仮の値が「設定済み」として使われていた
- 埋め込み（embed.js）を `<head>` に置くと `<head>` の中に描いていた・src にフラグメントがあると取得に失敗していた・カードを取り除いても取得が続いていた
- タブを隠して戻すたびに、ライブ更新の周期が1本ずつ増えていた
- SVG の id が、同じページに複数のカードを置くと衝突していた。折り返しで単語どうしがつながる・ギリシャ文字などの単語を途中で割る不具合も直した
- ライトテーマの「no art」の文字色とデモ画面の文字色が WCAG AA を満たしていなかった
- 透過の `/embed` が、埋め込み先と配色が違うと透けなかった
- generate が途中で失敗しても、古い出力と新しい出力が混ざらない。`data/auth.json` の書き込みの途中で落ちても refresh_token を失わない
- 壊れた `snapshot.json` で generate が落ち続けていた。ログの曲名の改行で Actions のワークフローコマンドを差し込めた

- README の JSON データ取得例で、再生中に `mood` が `null` でも曲情報を表示できるようにする
- 再生中の曲に Spotify のリンク（`external_urls`）が無いときも落ちず、`spotify_url` を空文字にしてキーを残す
- OpenAI 互換 API が `message.content` を text parts の配列で返す場合も、ムード文を取り出せる
- ムード文のプロンプトに渡す曲名などを、絵文字の途中で切らないようにコードポイント単位で切り詰める
- `setup` の refresh_token の取り直しの目安日が、月末に取得すると7か月後にずれるのを直す（8/31 → 2/28）
- ローカルファイルなど ID の無いアーティストを `/artists` の問い合わせに含めない（`ids=,abc` で 400 になっていた）
- LLM の 5xx・タイムアウトの再試行の待ちを 600〜1200ms でばらつかせる
- Node 版で、リポジトリの外のフォルダから起動しても `/embed.js` とデモ画面（`/`）が 404 にならないようにする（静的ファイルの場所を作業ディレクトリでなくこのファイルの位置から決める）

## [1.7.0] - 2026-11-04

### アップグレード時に確かめること

- LLM のエンドポイント（`LLM_BASE_URL`）が `http://` のリモートだと、API キーを送らずムード文なしで動きます。`https://` にしてください（`localhost`・`127.0.0.1`・`[::1]` の http はそのまま使えます）
- 本番相当（`NODE_ENV=production`・Workers）で `CORS_ORIGIN` が未設定（`*`）だと、起動時に警告が出ます。`CORS_ORIGIN` はカンマ区切りで複数書けるようになりました
- レート制限を超えたとき、`/badge.svg` と `/embed` は JSON の 429 ではなく「取得できませんでした」のカードを返します（理由は `X-Spotify-Embedded-Error: rate_limited`）

### 追加

- `CORS_ORIGIN` にカンマ区切りで複数のオリジンを書ける
- Spotify が新しい refresh_token を返したら、プロセスの中では新しい方を使い、`data/auth.json` なら書き戻す。環境変数なら更新が要ることを警告する
- `npm run setup` の完了時に、refresh_token を取り直す目安の日付（6か月後）を表示する
- ランキング SVG の `<desc>` に順位・曲名・アーティストを入れ、スクリーンリーダーに届くようにする
- すべての応答に `Permissions-Policy`、https なら `Strict-Transport-Security` を付ける。デモ画面と静的モードの `index.html` にも CSP を付ける

### 変更

- now-playing カードの再生中インジケータを CSS アニメーションにし、OS の「視差効果を減らす」設定で止まるようにする
- `/embed`・`embed.js`・デモ画面の定期取得を揃える: 非表示のタブでは止め、表示に戻ったらすぐ取り直し、10 秒で打ち切り、続けて失敗したら間隔を伸ばす
- `embed.js` は同じ内容ならカードを作り直さない（キーボードのフォーカスを失わせない）
- IPv6 のレート制限を /64 単位で数える
- 再生履歴を10件まで見て、直近のローカルファイルの手前のカタログの曲を「最後に聴いた曲」にする

### 修正

- 括弧の内側に句点のあるムード文（「…です。」）が捨てられていた
- 絵文字の ZWJ シーケンス・国旗などで曲名の省略が文字化けし、CJK 拡張 B の漢字・新しい絵文字・長い英単語が SVG の枠からはみ出していた
- `embed.js`: 最初の取得に失敗すると何も表示されなかった・不正な `data-target` で止まっていた・フォントが SVG とずれていた
- `/embed` のライブ更新で、ジャケ写の有無が変わると前の曲のジャケ写が残っていた
- 静的モードの `index.html` のランキングで、ジャケ写の無い曲に `src=""` の画像が出ていた
- `/artists` が一時的に失敗しただけで、そのプロセスではジャンルを二度と取らなくなっていた
- Spotify の `Retry-After` が秒数でないと、429 の `Retry-After` が `NaN` になっていた
- `/auth/callback`: 承認の拒否が「Missing code parameter」になり、交換の失敗が原因の分からない 500 になっていた。refresh_token は既定で伏せて表示するようにした
- Windows で `npm run setup` が途中で切れた認可 URL を開き、`npm run auth` が起動しなかった。ポート使用中の案内も Windows のコマンドにした
- `generate --limit 10abc` のような値を黙って受け付けていた
- 同時に来たトークン更新が並列に送られていた（`generate` では毎回2回）
- ジャケ写の取得でリダイレクト先を確かめず、サイズ上限を読み切った後に判定していた

## [1.6.1] - 2026-10-23

### 修正

- Node 版のレート制限を Workers 版と同じ 60 秒あたり 100 回に揃える（それまでは 15 分あたり 100 回）
- 壊れた `snapshot.json` で `generate` が落ち続ける不具合を直す
- `npm run setup` で LLM を外しても、`GROQ_API_KEY` などの別名の行が残って有効なままだった
- dev 依存の vite・undici・vitest を脆弱性の修正版に上げる（#92）

## [1.6.0] - 2026-10-19

### 追加

- `--theme both` のとき、iframe 用のライトテーマ版 `index-light.html` も書き出す（#89）

### 修正

- 静的モードの「LAST PLAYED」を、生成時刻基準の相対時刻ではなく日本時間の日時で出す（#88）
- ライトテーマのアクセント色を、白背景で 4.5:1 以上になる `#15803d` にする（#82）
- デモ画面が2回目の取得から更新されなくなっていた（#81）
- ランキングの「◯◯時点」の日付を、実行環境によらず日本時間で出す（#80）
- `embed.js` の `data-refresh` も 10〜3600 秒に丸める（#79）
- `Accept` ヘッダーの品質値に従って JSON / YAML を選ぶ（#78）

## [1.5.0] - 2026-10-14

### アップグレード時に確かめること

- Node の下限を 22 に上げた（#60）
- KV namespace の ID を `wrangler.jsonc` から外し、初回の `wrangler deploy` での自動作成に任せる（#63）

### 追加

- 静的モードで「最後に聴いた曲」を `last-played.json` / `.yaml` にも出力する（#62）

## [1.4.2] - 2026-10-14

### 修正

- Spotify の失敗時も `/badge.svg` と `/embed` は「取得できませんでした」のカードを返す（#58）
- Spotify API・トークン更新・ジャケ写の取得にタイムアウトを付ける（#53）
- `/embed` のライブ更新で、ムード文の有無が変わったら読み込み直す（#52）
- トークン更新の `invalid_grant` / `invalid_client` を認証エラーとして扱う（#50）
- 非表示のタブではライブ更新の定期取得を止める（#51）
- ローカルファイルの再生中を「再生していない」として扱う（#49）
- Cloudflare の Secrets が無いフォークでは Workers へのデプロイを省く（#55）
- SIGTERM / SIGINT で、処理中のリクエストを待ってから終了する（#54）

## [1.4.1] - 2026-10-13

### 変更

- ランキングのムード文は、上位10曲のうち3曲が入れ替わったら作り直す（#34）

## [1.4.0] - 2026-10-12

### 変更

- ムード文のプロンプトインジェクション対策（#23, #25）
- セキュリティレビューの Low / Info 項目への対応: `/auth` の state を Cookie に、`/embed`・SVG に CSP、Actions の権限の絞り込みなど（#26）

## [1.3.0] - 2026-10-06

### アップグレード時に確かめること

- 新しいスコープ `user-read-recently-played` を使う。それ以前に発行した refresh_token には含まれないため、使うには `npm run setup` で取り直す（取り直さなくても従来どおり動く）

### 追加

- 静的モードで停止中は、再生履歴から「最後に聴いた曲」を取る（#21）

### 修正

- ムード文の取りこぼし: タイムアウト時に再試行し、失敗した null を使い回さない（#22）

## [1.2.0] - 2026-10-04

### 変更

- 依存パッケージと GitHub Actions の更新（利用者から見える変更はありません）

## [1.1.0] - 2026-09-28

### アップグレード時に確かめること

- ライブAPIは now-playing だけになりました。ランキングは静的モード（`top-tracks.json`・`ranking.svg`）を使ってください

### 追加

- ランキング全体のムード文（上位曲の顔ぶれが変わったときだけ作り直す）
- Gemini への対応と、`npm run setup` の LLM の接続確認

### 変更

- ライブAPIの推奨の実行環境を Cloudflare Workers にする

### 修正

- 2024年11月以降に作成された Spotify アプリで返らない項目（`popularity` など）を扱えるようにする
- ライブ更新でカードが再生状況とずれていた

## [1.0.1] - 2026-09-19

### 修正

- リリースの成果物のパッケージングを直す

[Unreleased]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.0.0...v1.0.1
