# 変更履歴

利用者から見た変更を版ごとに記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
版の付け方は [セマンティック バージョニング](https://semver.org/lang/ja/) に従います。
**アップグレード時に対応が要る変更**は各版の先頭に書きます。

リリースのタグを push すると、`release.yml` がこのファイルにその版の見出し（`## [x.y.z]`）があるかを確かめます。

## [Unreleased]

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

[Unreleased]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.6.1...HEAD
[1.6.1]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Sh1n1230/SpotifyEmbedded/compare/v1.2.0...v1.3.0
