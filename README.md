# SpotifyEmbedded

Spotifyで再生中の楽曲や再生履歴からLLMがムード文（聴取状況から推論した一言）を生成し、GitHubのREADMEやWebサイトへ埋め込むためのセルフホスト向け表示カード生成システムです。

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://sh1n1230.github.io/SpotifyEmbedded/now-playing.svg">
    <img src="https://sh1n1230.github.io/SpotifyEmbedded/now-playing-light.svg" alt="Now Playing" width="500">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://sh1n1230.github.io/SpotifyEmbedded/ranking.svg">
    <img src="https://sh1n1230.github.io/SpotifyEmbedded/ranking-light.svg" alt="Top Tracks" width="500">
  </picture>
</p>

<p align="center"><sub>上記は本リポジトリの静的モード（GitHub Actions）が生成した作者のSpotifyデータです。</sub></p>

[![CI](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/ci.yml/badge.svg)](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Sh1n1230/SpotifyEmbedded)](LICENSE)
[![Security Check](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/security.yml/badge.svg)](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/security.yml)
[![Update Spotify snapshot](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/update-spotify.yml/badge.svg)](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/update-spotify.yml)

---

## 特長と配信モード

本プロジェクトには、サーバー管理が不要な「静的モード」と、秒単位の更新に対応する「ライブAPIモード」の2つの配信方式があります。

| 方式 | 常時稼働サーバー | 更新頻度 | 必要なアカウント | 費用の目安 | 主な用途 |
|---|---|---|---|---|---|
| **静的モード** | 不要 | 数十分〜数時間ごと（※） | GitHub・Spotify | 公開リポジトリなら無料 | GitHub README、ブログ、個人サイト |
| **ライブAPIモード** | 必要 | 秒単位 | Spotify・Cloudflare（またはコンテナ実行環境） | Workersの無料枠で稼働可能 | ポートフォリオサイトで即時反映させたい場合 |

※ GitHub Actions のスケジュール実行や画像プロキシのキャッシュによる遅延を含みます。

ムード文を生成する場合は LLM の API キーが必要です（Google Gemini などの無料枠で運用できます。LLM 未設定時も楽曲情報のみでカードが生成されます）。

ライブAPIモードが扱うデータは、リアルタイムな更新を要する再生中情報（now-playing）に限定されます。ランキング情報は数週間から1年単位の集計値であり、毎秒の即時性を必要としないため、静的モードでのみ生成します。なお、now-playing の JSON スキーマは両モードで共通しているため、静的モードからライブAPIモードへの移行は参照先 URL の変更のみで完了します。

### 先行ツールとの違い

再生中の楽曲情報を SVG 画像として出力する先行ツールに対して、本プロジェクトには次の特徴があります。

- **日本語によるムード文の自動生成**：再生中の楽曲メタデータから推論したムード文を提示し、楽曲名やアルバム名はムード文の根拠として併記します。
- **Webサイトへの埋め込みを主眼とした設計**：GitHub README への画像埋め込みだけでなく、Shadow DOM によるスタイル隔離を施した埋め込みスクリプト、iframe、ライト/ダークテーマ切り替えを提供します。
- **データとしての再利用性**：表示用 SVG に加え、外部プログラムから参照可能な JSON および YAML の公開スキーマ（[JSON Schema](schema/)）を配備しています。
- **配信モード間でのスキーマ統一**：サーバー不要の静的モードとリアルタイムなライブAPIモードで出力形式を統一しており、運用の初期段階は静的モードで始め、後からライブAPIモードへ最小限の変更で切り替えられます。

---

## クイックスタート（静的モード）

GitHub Actions が Spotify Web API からデータを定期取得し、SVG・JSON・HTML を生成して公開ブランチへ反映します。常時稼働サーバーを用意する必要はありません。認証トークンは GitHub Secrets にのみ保管され、公開されるのは楽曲名やアルバムアートの URL などの生成済みデータに限定されます。

### 1. 準備

動作には Node.js 22 以上（`.nvmrc` の指定バージョンを推奨）が必要です。本リポジトリをフォークし、作業環境へクローンします。

```bash
git clone https://github.com/<username>/SpotifyEmbedded.git
cd SpotifyEmbedded
npm ci --ignore-scripts
```

続いて [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリケーションを作成します（API の選択画面では **Web API** を選択します）。作成後、**Settings → Redirect URIs** に次の URI を登録します。

```
http://127.0.0.1:3000/auth/callback
```

Spotify の仕様により、Redirect URI に `localhost` は使用できません。ループバック IP アドレス（`127.0.0.1` または `[::1]`）を明示して登録してください（[Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)）。

ムード文の生成に用いる LLM は、OpenAI の Chat Completions API 形式（`POST {baseUrl}/chat/completions`）を受け付けるエンドポイントであれば自由に選択できます。

| プロバイダ | エンドポイント | 既定モデル | 備考 |
|---|---|---|---|
| **Google Gemini（推奨）** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.1-flash-lite` | 無料枠あり |
| OpenAI | `https://api.openai.com/v1` | —（`LLM_MODEL` の指定が必須） | 従量課金 |
| その他（Groq / OpenRouter / ローカル等） | 任意の OpenAI 互換 URL | — | モデル名を個別指定 |

> [!NOTE]
> Gemini の OpenAI 互換エンドポイントは `/v1beta/openai` です。`/v1beta` や `/v1beta/interactions` を指定すると 401 または 404 エラーとなります。本プロジェクトでは Gemini へのリクエスト時に `reasoning_effort: "none"` を付与し、思考出力によるトークン枯渇を防ぐ処理を内蔵しています。
> プロバイダの選択は対話型セットアップ時に指定します。LLM の設定を省略した場合でも、楽曲情報のみでカードが生成されます。

### 2. セットアップの実行

```bash
npm run setup
```

コマンドを実行すると一時ローカルサーバーが起動し、ブラウザで Spotify の認可画面が開きます。認証を完了すると、スクリプトが次の処理を実行します。

- `refresh_token` の取得と `.env` および `data/auth.json` への保存
- LLM への接続検証（短文を1件生成し、URL やモデル名の設定誤りを即座に検出）
- GitHub Secrets への自動登録（`gh` CLI が利用可能な場合は自動登録し、未導入の場合は手動設定用の値を表示）

> [!WARNING]
> Spotify の `refresh_token` は、継続利用中であっても承認から6か月で失効します（[Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)）。`npm run setup` 完了時に表示される目安日までにコマンドを再実行してください。GitHub Secrets も同時に更新されます。失効時の対処は[トラブルシューティング](#invalid_grant-エラーによる認証失敗)を参照してください。

### 3. ワークフローの有効化

フォークしたリポジトリでは GitHub Actions が初期状態で無効化されています。次の手順で有効化してください。

1. **Actions** タブを開き、**I understand my workflows, go ahead and enable them** を選択します。
2. **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選択します。
3. **Actions → Update Spotify snapshot → Run workflow** から初回実行を手動でトリガーします。完了すると `spotify-data` ブランチが作成され、続いて `Deploy GitHub Pages` ワークフローが起動してファイル群が公開されます。

以後は GitHub Actions が定期的に実行され、データが自動更新されます。

---

## 埋め込みと利用方法

生成物は `https://<username>.github.io/SpotifyEmbedded/` 以下に公開されます（リポジトリ名を変更した場合はその名前に置き換えてください）。

### GitHub README への埋め込み

`<picture>` タグを用いることで、閲覧者のテーマ設定（ダーク/ライト）に応じたカード画像が自動で切り替わります。

```markdown
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://<username>.github.io/SpotifyEmbedded/now-playing.svg">
  <img src="https://<username>.github.io/SpotifyEmbedded/now-playing-light.svg" alt="Now Playing">
</picture>
```

### Webサイトへの埋め込み

Webサイトには iframe または埋め込みページを配置できます。

```html
<!-- ダークテーマ（既定） -->
<iframe src="https://<username>.github.io/SpotifyEmbedded/"
        title="Spotify で最後に聴いた曲"
        width="500" height="180" style="border: 0" loading="lazy"></iframe>

<!-- ライトテーマ -->
<iframe src="https://<username>.github.io/SpotifyEmbedded/index-light.html"
        title="Spotify で最後に聴いた曲"
        width="500" height="180" style="border: 0" loading="lazy"></iframe>
```

> [!NOTE]
> iframe 向けページにはカードの下にランキングも描画されます。`height="180"` ではカードのみが表示されます。ランキングまで表示する場合の高さの目安は `260 + 57 × 件数`（ムード文を含む場合は約30を加算）です。

### データとしての利用

外部プログラムや静的サイトジェネレーター（Hugo、Jekyll等）向けに、JSON と YAML の形式でデータを配信しています。

```js
// JavaScriptからの取得例（ライブAPIと同一スキーマ）
const res = await fetch('https://<username>.github.io/SpotifyEmbedded/now-playing.json');
const data = await res.json();
```

```bash
# Hugo: data/spotify.yaml として取得し、テンプレートから参照
curl -fsS -o data/spotify.yaml https://<username>.github.io/SpotifyEmbedded/last-played.yaml

# Jekyll: _data/spotify.yaml として取得
curl -fsS -o _data/spotify.yaml https://<username>.github.io/SpotifyEmbedded/last-played.yaml
```

### 生成ファイル一覧

| ファイル | 内容 |
|---|---|
| `now-playing.svg` / `now-playing-light.svg` | 再生中・最後に聴いた曲のムード文つきカード画像（ダーク / ライト） |
| `ranking.svg` / `ranking-light.svg` | トップトラック画像（既定: 直近4週間の上位5件）。LLM設定時はランキング全体のムード文を記載 |
| `now-playing.json` / `.yaml` | ライブAPIと同一スキーマのデータ（再生停止時は `track: null`） |
| `last-played.json` / `.yaml` | カード画像と同じ「最後に聴いた曲」（`track` / `mood` / `played_at`、静的モード限定） |
| `top-tracks.json` / `.yaml` | ランキングデータ（静的モード限定） |
| `index.html` / `index-light.html` | iframe用HTMLページ（ダーク / ライト） |
| `robots.txt` | 検索エンジンインデックス抑止ファイル（`--index` 付与時は生成除外） |

データ構造の詳細は [JSON Schema](schema/)（`now-playing.schema.json`、`top-tracks.schema.json`、`last-played.schema.json`）を参照してください。`snapshot.json` は次回実行へ状態を引き継ぐための内部ファイルであり、GitHub Pages には公開されません。

カードの見出し時刻（`NOW PLAYING · 10/16 21:04`、`LAST PLAYED · 10/16 21:04`）は日本時間で表記されます。

### 再生停止時の動作

楽曲の再生が停止しているときは、Spotify の再生履歴（`recently-played`）から直近に聴き終えた楽曲を取得して表示します。GitHub Actions の実行間隔が数時間空いた場合でも、その間に聴いた楽曲がカードへ反映されます。再生履歴が取得できない場合も、直前の観測結果を `snapshot.json` から引き継ぐため、カードが空のプレースホルダー表示になる事態を防ぎます。

- **再生中**: 再生中の楽曲情報を表示（`played_at` は取得時刻）。
- **停止中**: 最後に聴いた楽曲を表示（`played_at` は聴き終えた時刻、または前回取得時刻）。
- **履歴・前回データなし**: `{ "track": null, "mood": null, "played_at": null }` を返却。

> [!NOTE]
> 再生履歴の取得には `user-read-recently-played` スコープが必要です（v1.3.0 で追加）。v1.2.0 以前に取得した `refresh_token` を利用している場合は、`npm run setup` を再実行してスコープを更新してください。

### 更新間隔とキャッシュ仕様

ワークフロー定義では30分間隔でスケジュールを設定していますが、GitHub Actions の `schedule` トリガーは定刻起動を保証せず、混雑状況によって実行間隔が数時間空く場合があります。また、GitHub の画像キャッシュプロキシ（camo）の影響により、README 上の表示更新にはさらなる遅延が加わります。

手動で即座に更新したい場合は、**Actions → Update Spotify snapshot → Run workflow** を実行してください。秒単位での即時反映が必要な場合は、後述のライブAPIモードを利用します。

README 上の画像キャッシュを直ちに削除したい場合は、ページの HTML から対象画像の `camo.githubusercontent.com/...` URL を確認し、`curl -X PURGE <その URL>` を送信してください（[About anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)）。

### ローカル環境での静的ファイル生成

GitHub Actions を使わず、ローカル環境で直接静的ファイルを生成できます。事前に `npm run setup` を完了させておく必要があります。

```bash
npm run generate                      # ./out に出力
npm run generate -- --out ./public --count 10 --theme dark
npm run generate -- --range medium_term --limit 30 --count 10
npm run generate -- --no-mood         # LLM呼び出しをスキップ
```

| オプション | 既定値 | 説明 |
|---|---|---|
| `--out <dir>` | `./out` | 出力先ディレクトリ |
| `--range <name>` | `short_term` | ランキングの集計期間（`short_term`: 約4週間、`medium_term`: 約6か月、`long_term`: 約1年） |
| `--limit <n>` | `50` | Spotify から取得する件数（`10` / `30` / `50`） |
| `--count <n>` | `5` | ランキングの表示件数（1〜50、`--limit` 以下） |
| `--page-count <n>` | `--count` と同じ | iframe 用ページ（`index.html`）の表示件数（1〜50） |
| `--theme <name>` | `both` | テーマ指定（`dark` / `light` / `both`） |
| `--no-mood` | — | ムード文の生成をスキップ（保存済みランキングムード文は保持） |
| `--refresh-ranking-mood` | — | 顔ぶれの変化に関わらずランキングムード文を再生成 |
| `--index` | — | 検索エンジンのインデックスを許可（`noindex` と `robots.txt` を除外） |

定期実行時の期間や件数を変更する場合は、ワークフローファイルを直接編集せず、リポジトリの **Settings → Secrets and variables → Actions → Variables** に `RANKING_RANGE`（`short_term` / `medium_term` / `long_term`）および `RANKING_COUNT`（1〜50）を設定してください。優先順位は「手動実行時の入力 > Variables > 既定値」です。

---

## ライブAPIモード

再生中の楽曲情報を秒単位でリアルタイムに反映したい場合は、常時稼働サーバー（Node.js または Cloudflare Workers）を利用するライブAPIモードを選択します。ライブAPIモードは now-playing（再生中情報）のエンドポイントのみを提供します。ランキング情報が必要な場合は、静的モードで生成した `ranking.svg` または `top-tracks.json` を併用してください。

```bash
npm run setup      # 初期設定が未完了の場合
npm run dev        # ローカルサーバー起動（http://127.0.0.1:3000）
```

### クライアントへの埋め込み

#### JavaScript 埋め込み（推奨）

Webサイトの既存 CSS との干渉を防ぐため、カードコンポーネントは Shadow DOM 内部に描画されます。

```html
<div id="spotify"></div>
<script src="https://your-api.example.com/embed.js"
        data-target="#spotify"
        data-theme="dark"
        data-refresh="30"></script>
```

| 属性 | 既定値 | 説明 |
|---|---|---|
| `data-target` | (スクリプトの直後) | 描画先の CSS セレクタ |
| `data-theme` | `dark` | テーマ（`dark` / `light` / `auto`。`auto` は閲覧者の OS 設定に連動） |
| `data-max-width` | `460` | 最大幅（px、240〜1920。`full` で親要素の幅全体） |
| `data-transparent` | `false` | `true` で背景を透過 |
| `data-refresh` | `30` | 更新間隔（秒、10〜3600） |

#### iframe

```html
<iframe src="https://your-api.example.com/embed?theme=dark"
        title="Spotify で再生中の曲"
        width="500" height="180" style="border: 0" loading="lazy"></iframe>
```

#### SVG 画像（GitHub README 等）

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://your-api.example.com/badge.svg">
  <img src="https://your-api.example.com/badge.svg?theme=light" alt="Now Playing">
</picture>
```

#### JSON データ取得

```js
const res = await fetch('https://your-api.example.com/api/now-playing');
const data = await res.json();
if (data.is_playing) {
  console.log(data.mood?.text);          // 例: "ダークな気分に浸っているようです"
  console.log(data.track.name);          // 曲名
  console.log(data.track.album_art_url); // カバー画像URL
}
```

楽曲変更直後のムード文生成について、ライブAPIは最大5秒間だけ完了を待ちます。制限時間を超過した場合は一度 `mood: null` で応答し、バックグラウンドで生成を完了させて次回の取得（既定で30秒後）から反映します。生成処理の遅延によって楽曲情報やカード画像の返却全体が滞る事態を防ぐためです。

### レート制限とアクセス管理

レート制限は、Node.js 版・Cloudflare Workers 版ともに接続元 IP ごとに 60 秒あたり 100 リクエストを目安としています（`/health` は制限対象外）。制限を超過した場合、`/api/now-playing` は 429 と `Retry-After` を返し、`/badge.svg` と `/embed` はエラー案内カードを返します。

| 項目 | Node.js 版 | Cloudflare Workers 版 |
|---|---|---|
| カウント方式 | プロセス内メモリで厳密に集計 | [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) による拠点ごとの近似集計 |
| レート制限ヘッダー | `RateLimit-Limit` 等を付与 | 付与なし |
| `Retry-After`（429時） | リセットまでの残り秒数 | 60秒固定 |

本番運用環境では、`CORS_ORIGIN` を自身の Web サイトのオリジンに限定してください。未設定（`*`）のままだと第三者の Web サイトから API を呼び出され、Spotify の API 利用枠や LLM のトークン利用料が消費される要因となります。

---

## デプロイ（ライブAPIモード）

常時稼働サーバーには、起動遅延がなく無料枠で運用できる Cloudflare Workers を推奨します。データベースの用意は不要です。

### Cloudflare Workers（推奨）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Sh1n1230/SpotifyEmbedded)

Cloudflare Workers は実行環境の起動が数ミリ秒で完了するため、アクセス頻度が低い状態でも GitHub README の画像プロキシ（camo）のタイムアウト制限内に応答できます。

```bash
npx wrangler login
npm run deploy
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put SPOTIFY_REFRESH_TOKEN
npx wrangler secret put LLM_API_KEY              # 任意
```

`npm run setup` の完了後は、`npx wrangler secret bulk .env` で環境変数を一括登録できます。ムード文の永続化に用いる Workers KV ネームスペース（`MOODS` バインディング）は初回の `npm run deploy` 時に自動作成されるため、事前の手動作成は不要です（[automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)）。

- 楽曲ごとのムード文は Workers KV に永続化されます。実行インスタンスがリクエスト終了後に破棄されやすいため、インメモリキャッシュのみでは同一楽曲に対する重複推論を防げない構造への対策です（KV 無料枠の書き込み上限は1日1,000回）。
- Workers 環境ではローカルファイルシステムが存在しないため、`data/auth.json` は利用されず、すべての設定を Wrangler のシークレット機能で環境変数として渡します。

### Docker（Fly.io / Cloud Run / VPS）

```bash
docker build -t spotify-embedded .
docker run -p 3000:3000 --env-file .env spotify-embedded
```

- **待機時の最小インスタンス数**: Cloud Run や Fly.io などのサーバーレスコンテナ環境では、待機時のマシン停止を無効化（最小インスタンス数を1以上に設定）してください。コールドスタートに数秒を要すると、GitHub camo が画像の取得を打ち切り、カード画像が表示されなくなります。
- **リバースプロキシ配下での設定**: プロキシ配下に配置する場合は `TRUSTED_PROXY_HEADER`（Fly.io なら `fly-client-ip`、Cloud Run なら `x-forwarded-for`）を設定してください。未設定の場合、全接続元がプロキシの IP アドレスとして認識され、レート制限枠を全ユーザーで共有してしまいます。

### 静的モードとライブAPIの併用

ランキング画像を静的モード（GitHub Actions）、再生中カードをライブAPIモード（Cloudflare Workers）で運用する構成が可能です。`npm run setup` で認証情報を取得後、GitHub Secrets と `wrangler secret` の双方に同じ認証情報を登録してください。

---

## APIリファレンス

### `GET /api/now-playing`

再生中の楽曲情報およびムード文を返却します。JSON（既定）および YAML（`?format=yaml` または `Accept: application/yaml`）に対応しています。

```json
{
  "is_playing": true,
  "progress_ms": 42000,
  "track": {
    "id": "5wujBwqG7INdStqGd4tRMX",
    "name": "Armed And Dangerous",
    "artist": "Juice WRLD",
    "album": "Goodbye & Good Riddance",
    "album_art_url": "https://i.scdn.co/image/...",
    "duration_ms": 169999,
    "explicit": true,
    "popularity": null,
    "spotify_url": "https://open.spotify.com/track/...",
    "preview_url": null
  },
  "mood": {
    "text": "ダークな気分に浸っているようです",
    "generated_at": "2026-09-19T13:35:14.667Z",
    "model": "gemini-3.1-flash-lite"
  },
  "fetched_at": "2026-09-19T13:35:14.669Z"
}
```

再生していない状態では、`is_playing: false`、`progress_ms: null`、`track: null`、`mood: null` を返します。ポッドキャストのエピソードとローカルファイルは楽曲として扱わず、再生していない状態と同じ応答になります。

#### エラー応答

エラー時の本文は `{ "error": "<説明文>", "code": "<エラーコード>" }` の形式で返却されます。プログラムによる分岐には `code` フィールドを使用してください。

| HTTPステータス | `code` | 説明 |
|---|---|---|
| 429 | `rate_limited` | 本APIのレート制限超過（`Retry-After` 付与） |
| 503 | `spotify_rate_limited` | サーバーが Spotify のレート制限に到達 |
| 503 | `not_configured` | サーバーに必須の設定情報が存在しない |
| 502 | `spotify_auth_failed` | `refresh_token` の失効等による認証失敗 |
| 502 | `spotify_error` | Spotify API の処理失敗 |
| 502 | `spotify_unreachable` | Spotify へのネットワーク疎通失敗 |
| 504 | `spotify_timeout` | Spotify API の応答タイムアウト |
| 400 | `bad_request` | クライアントリクエストの形式不正 |
| 404 | `not_found` | 存在しないエンドポイントへのアクセス |
| 500 | `internal_error` | サーバー内部の想定外エラー |

### 埋め込み用エンドポイント

| パス | 種別 | クエリパラメータ | 説明 |
|---|---|---|---|
| `GET /badge.svg` | SVG | `theme`（`dark` / `light`） | now-playing カード画像（背景透過） |
| `GET /embed` | HTML | `theme`, `transparent`, `refresh`, `max_width` | iframe 埋め込み用 HTML |
| `GET /embed.js` | JS | — | Shadow DOM 埋め込み用スクリプト |
| `GET /health` | JSON | — | 稼働状態とバージョン確認 |

---

## 設定

本プロジェクトの設定は、環境変数または `data/auth.json` から読み込まれます。優先順位は **環境変数 → `data/auth.json`** です。

| 変数名 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `SPOTIFY_CLIENT_ID` | ✓ | — | Spotify アプリケーションの Client ID |
| `SPOTIFY_CLIENT_SECRET` | ✓ | — | Spotify アプリケーションの Client Secret |
| `SPOTIFY_REFRESH_TOKEN` | ✓ | — | `npm run setup` で取得したリフレッシュトークン |
| `LLM_API_KEY` | | — | LLM の API キー（未設定時はムード文を省略して動作） |
| `LLM_BASE_URL` | | キー名から推定 | OpenAI 互換エンドポイント（末尾の `/chat/completions` は不要、`https://` 必須） |
| `LLM_MODEL` | | Gemini は `gemini-3.1-flash-lite` | 使用モデル名（Gemini 以外のプロバイダでは設定必須） |
| `LLM_MAX_TOKENS` | | `80` | ムード文生成時の最大トークン数（16〜4096） |
| `LLM_TEMPERATURE` | | `0.7` | ムード文生成時の temperature（0〜2） |
| `NOW_PLAYING_CACHE_SECONDS` | | `30` | ライブAPIのメモリキャッシュ保持秒数（5〜300） |
| `SPOTIFY_REDIRECT_URI` | | `http://127.0.0.1:<PORT>/auth/callback` | 認可コールバック先 URI |
| `PORT` | | `3000` | サーバーの待受ポート番号（Node.js 版） |
| `HOST` | | 全インターフェース | 待ち受けホスト（Node.js 版） |
| `CORS_ORIGIN` | | `*` | 許可するオリジン（カンマ区切りで複数指定可、本番環境では限定を推奨） |
| `TRUSTED_PROXY_HEADER` | | — | リバースプロキシ配下でのクライアント IP 参照ヘッダー |
| `AUTH_STORE_PATH` | | `data/auth.json` | 認証情報のファイル保存先パス |

`LLM_API_KEY` には `OPENAI_API_KEY`、`GEMINI_API_KEY`、`GOOGLE_API_KEY`、`GROQ_API_KEY`、`OPENROUTER_API_KEY` の名称も利用可能です。`LLM_BASE_URL` が未指定の場合は、指定された環境変数名に基づいて接続先エンドポイントが自動選択されます。

---

## トラブルシューティング

### `invalid_grant` エラーによる認証失敗

GitHub Actions の `Update Spotify snapshot` が失敗する、またはライブAPIが 502 エラー（`spotify_auth_failed`）を返す場合は、`refresh_token` が失効しているか取り消されています。主な要因は6か月の有効期限到達、Spotify アカウント連携の解除、または Client Secret の再発行です。

`npm run setup` を再実行してトークンを再取得し、利用環境へ反映してください。

| 実行環境 | 反映手順 |
|---|---|
| 静的モード（GitHub Actions） | `gh` CLI があれば `npm run setup` が自動更新します。未導入時はリポジトリの **Settings → Secrets and variables → Actions** で `SPOTIFY_REFRESH_TOKEN` を更新します。 |
| Cloudflare Workers | `npx wrangler secret put SPOTIFY_REFRESH_TOKEN` を実行します。 |
| Docker | `.env` またはマウントされた `data/auth.json` を更新してコンテナを再起動します。 |

### 認可完了後に 403 Forbidden となる

新しく作成した Spotify アプリケーションは Development Mode（開発モード）で動作します。このモードでは、Spotify Developer Dashboard の **User Management** に登録された Spotify アカウントのみが API を利用できます（[Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)）。アプリを作成したアカウントと音楽を再生するアカウントが異なる場合は、再生側のアカウントを User Management に追加してください。

### ムード文が生成されない

楽曲情報は表示されているにもかかわらずムード文のみが出力されない場合は、実行ログ（GitHub Actions の実行ログ、`wrangler tail`、またはコンテナログ）を確認してください。`[mood] ムード文を省略しました:` で始まるメッセージが出力されています。

| ログメッセージ | 原因と対処 |
|---|---|
| `LLMのAPIキーが拒否されました` | `LLM_API_KEY` の指定誤りまたは期限切れです。API キーを再確認または再発行してください。 |
| `モデル "…" が見つかりません` | `LLM_MODEL` と `LLM_BASE_URL` の組み合わせが不正です。利用可能なモデル名を指定してください。 |
| `LLM がリクエストを受け付けませんでした` | 指定したモデルが対象エンドポイントで提供されているか確認してください。 |
| `LLM_MODEL が設定されていません` | Gemini 以外のプロバイダでは `LLM_MODEL` の指定が必須です。モデル名を設定してください。 |
| `API キーが平文で送られるため…` | `LLM_BASE_URL` に `http://` のリモートアドレスが指定されています。`https://` を指定してください。 |
| `LLMへのリクエストがタイムアウトしました` | 一時的な接続遅延です。頻発する場合は接続先プロバイダの稼働状態を確認してください。 |
| `ムード文として採れない出力でした` | モデルの出力文字数が長すぎるか、無効な文字が含まれています。プロンプト仕様を満たす別のモデルを検討してください。 |

---

## 設計メモ

### audio-features を使わない理由

Spotify Web API では、2024年11月以降に作成された開発者アプリケーションに対して `/audio-features`（楽曲特徴量エンドポイント）の提供を停止しました。これに伴い、本プロジェクトでは特徴量に依存せず、アーティストのジャンル情報、人気度、楽曲名、アーティスト名、およびアルバム名を LLM に入力してムード文を推論する構造を採用しています。

さらに API の利用制限は拡大しており、新規作成されたアプリケーションでは `genres` と `popularity` の取得も制限されています（`/artists?ids=` のバッチ取得は 403 Forbidden が返却され、単体取得でも `genres` が除外されます）。2026年2月の変更では Development Mode アプリケーションからバッチ取得エンドポイント自体が廃止されました（[Web API Changelog - February 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)）。

そのため、多くの環境において実際にムード推論へ利用される入力は、楽曲名・アーティスト名・アルバム名の3項目に絞られます。取得できなかった項目はプロンプトから該当行を除外しています（「不明」などの欠損表現をプロンプトに含めると、生成されるムード文がその表現に影響を受けるためです）。

### ランキングのムード文を毎回作らない理由

ランキング情報は数週間から1年の長期間を集計対象とするため、データ取得のたびに LLM を呼び出すと、ほぼ同一の内容に対して無駄な API コストが発生します。一方で時間経過による TTL キャッシュ制御では、上位楽曲に変化がない場合でも期限切れに伴う不要な再生成が走り、逆に短時間で上位楽曲が大きく変動した場合でも期限までは古いムード文が維持されてしまいます。

そこで本プロジェクトでは、キャッシュの失効判定を「ランキングの構成楽曲の変動」に連動させています。

- ムード文は、表示件数に関わらず常に上位10曲のデータに基づいて生成します。
- 生成時点の上位10曲の ID を、生成根拠としてムード文とともに `snapshot.json` に記録します。
- 最新の上位10曲のうち、前回の生成根拠に含まれていなかった新規楽曲が3曲以上に達した段階で再生成を実行します（同一楽曲内の順位変動はトリガーとしません）。
- 比較対象は「直前の取得データ」ではなく「現行ムード文を生成した時点の構成」です。1曲ずつの緩やかな変化であっても、変化が累積すれば確実に再生成が実行されます。
- LLM 呼び出しに失敗した場合は既存のムード文を維持し、次回の更新サイクルで再試行します。
- 顔ぶれの変化に関わらず即座に作り直したい場合は `--refresh-ranking-mood`（GitHub Actions では Run workflow の `refresh_ranking_mood` 入力）を使用します。

---

## コントリビューション

開発手順や脆弱性の報告方法については [`CONTRIBUTING.md`](CONTRIBUTING.md) および [`SECURITY.md`](SECURITY.md) を参照してください。リリースは `vX.Y.Z` 形式のタグを起点に GitHub Actions が自動作成します。各バージョンの変更履歴は [`CHANGELOG.md`](CHANGELOG.md) に記録されています。

## ライセンス

本プロジェクトは [MIT License](LICENSE) のもとで公開されています。
