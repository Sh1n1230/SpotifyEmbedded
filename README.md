# SpotifyEmbedded

いま聴いている曲から、**AIが日本語で「今の気分」を一言にして**返します。それをポートフォリオサイトやGitHubのREADMEに埋め込むためのセルフホスト型ツールです。

> ダークな気分に浸っているようです
> — Armed And Dangerous / Juice WRLD

[![CI](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/ci.yml/badge.svg)](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/ci.yml)
[![Security Check](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/security.yml/badge.svg)](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/security.yml)

2つのモードがあります。**サーバーを持たなくても使えます。**

| | サーバー | リアルタイム性 | 向いている用途 |
|---|---|---|---|
| **静的モード** | **不要** | 30分ごとの更新 | GitHub README、ブログ、まず試したいとき |
| **ライブAPIモード** | 必要 | 秒単位 | ポートフォリオで「今まさに」を出したいとき |

どちらも出力するJSONのスキーマは同じなので、あとから移行するときは **fetch先のURLを差し替えるだけ**です。

---

## 静的モード（サーバー不要）

GitHub Actions が定期的にSpotifyを見に行き、SVG・JSON・HTMLを生成してブランチに公開します。常時稼働するサーバーはどこにもありません。トークンはGitHub Secretsの中だけに置かれ、公開されるのは曲名やジャケ写URLといった生成済みのデータだけです。

### 1. 準備

このリポジトリをフォークして、手元にクローンします。

```bash
git clone https://github.com/<あなた>/SpotifyEmbedded.git
cd SpotifyEmbedded
npm install
```

[Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリを作り、**Settings → Redirect URIs** に次を登録してください。

```
http://127.0.0.1:3000/auth/callback
```

ムード文の生成にはLLMを使いますが、**特定のサービスに縛られません。** OpenAIのChat Completions形式を話すエンドポイントなら何でも使えます。

| | エンドポイント | 備考 |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | 無料枠あり・カード不要 |
| OpenAI | `https://api.openai.com/v1` | 従量課金 |
| OpenRouter | `https://openrouter.ai/api/v1` | 1つのキーで多数のモデル |
| Ollama / LM Studio | `http://localhost:11434/v1` など | ローカル実行 |

次のステップで対話的に選べます。**設定しなくても構いません**（曲情報だけが表示されます）。

### 2. セットアップ

```bash
npm run setup
```

ブラウザが開くので Spotify で承認するだけです。**ターミナルからトークンをコピーする必要はありません。** コマンドが以下をすべて済ませます。

- `refresh_token` の取得
- `.env` と `data/auth.json` への保存
- `gh` CLI があれば **GitHub Secrets への登録**（`gh` が無い場合はコピー用の値を表示します）

### 3. 有効化

フォーク先で **Settings → Pages → Source** に `spotify-data` ブランチを指定します。あとは30分おきに自動更新されます。

すぐ試したいときは **Actions → Update Spotify snapshot → Run workflow** を実行してください。

### 4. 貼る

`https://<あなた>.github.io/SpotifyEmbedded/` 以下に生成物が並びます。

```markdown
<!-- GitHub README（ダーク/ライト自動切替） -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://<あなた>.github.io/SpotifyEmbedded/now-playing.svg">
  <img src="https://<あなた>.github.io/SpotifyEmbedded/now-playing-light.svg" alt="Now Playing">
</picture>
```

```html
<!-- 自分のサイトに（ホバー・Spotifyリンクが効きます） -->
<iframe src="https://<あなた>.github.io/SpotifyEmbedded/"
        width="500" height="180" frameborder="0" loading="lazy"></iframe>
```

```js
// データとして使う（ライブAPIと同じスキーマ）
const res = await fetch('https://<あなた>.github.io/SpotifyEmbedded/now-playing.json');
```

| ファイル | 内容 |
|---|---|
| `now-playing.svg` / `now-playing-light.svg` | ムード文つきカード |
| `ranking.svg` / `ranking-light.svg` | 直近4週間のトップ5 |
| `now-playing.json` / `.yaml` | ライブAPIと同一スキーマ |
| `top-tracks.json` / `.yaml` | 同上 |
| `index.html` | iframe用ページ |

**停止中でも「最後に聴いていた曲」を表示します。** 前回の観測結果を `snapshot.json` に持ち越しているので、カードが「再生していません」で埋まりません。

> **更新の間隔について**
> GitHubのスケジュール実行は定刻に走らず、数分から数十分ずれます。さらにGitHubは画像をキャッシュする（camoプロキシ）ため、README上の反映はもう少し遅れます。秒単位で追いたい場合は次のライブAPIモードを使ってください。

### ローカルで生成する

Actionsを使わず手元で生成することもできます。

```bash
npm run generate                      # ./out に出力
npm run generate -- --out ./public --count 10 --theme dark
npm run generate -- --no-mood         # LLM設定なしで実行
```

---

## ライブAPIモード

秒単位で「今まさに再生中」を出したい場合は、サーバーを1つ動かします。

```bash
npm run setup      # まだなら
npm run dev        # http://localhost:3000
```

### 埋め込み方

**ワンタグ** — 貼り付け先のCSSと干渉しないよう、カードはShadow DOMの中に作られます。

```html
<div id="spotify"></div>
<script src="https://your-api.example.com/embed.js"
        data-target="#spotify"
        data-theme="dark"
        data-ranking="false"
        data-refresh="30"></script>
```

| 属性 | 既定値 | 説明 |
|---|---|---|
| `data-target` | (スクリプトの直後) | 描画先のCSSセレクタ |
| `data-theme` | `dark` | `dark` / `light` |
| `data-ranking` | `false` | `true` でランキングも表示 |
| `data-transparent` | `false` | `true` で背景を透過 |
| `data-refresh` | `30` | 更新間隔（秒、最小10） |

**iframe**

```html
<iframe src="https://your-api.example.com/embed?theme=dark&ranking=true"
        width="500" height="180" frameborder="0"></iframe>
```

**SVG**（GitHub READMEにも貼れます）

```markdown
![Now Playing](https://your-api.example.com/badge.svg)
![Top Tracks](https://your-api.example.com/ranking.svg?count=5)
```

**データ**

```js
const res = await fetch('https://your-api.example.com/api/now-playing');
const data = await res.json();
if (data.is_playing) {
  console.log(data.mood.text);           // "ダークな気分に浸っているようです"
  console.log(data.track.name);          // "Armed And Dangerous"
  console.log(data.track.album_art_url); // ジャケ写のURL
}
```

---

## APIリファレンス

全エンドポイントがJSON（デフォルト）とYAML（`?format=yaml` または `Accept: application/yaml`）に対応しています。

### `GET /api/now-playing`

```json
{
  "is_playing": true,
  "track": {
    "id": "5wujBwqG7INdStqGd4tRMX",
    "name": "Armed And Dangerous",
    "artist": "Juice WRLD",
    "album": "Goodbye & Good Riddance",
    "album_art_url": "https://i.scdn.co/image/...",
    "duration_ms": 169999,
    "popularity": 78,
    "spotify_url": "https://open.spotify.com/track/...",
    "preview_url": null
  },
  "mood": {
    "text": "ダークな気分に浸っているようです",
    "generated_at": "2026-09-19T13:35:14.667Z"
  },
  "fetched_at": "2026-09-19T13:35:14.669Z"
}
```

再生していない場合は `is_playing: false`、`track: null`、`mood: null` を返します。

### `GET /api/top-tracks`

直近約4週間（`short_term`）の再生ランキングを最大50曲返します。各曲に `rank` と `genres` が付きます。

### `GET /api/status`

now-playing と top-tracks をまとめて返します。

### 埋め込み用エンドポイント

| パス | 内容 | クエリ |
|---|---|---|
| `GET /embed` | iframe用HTML | `theme` `ranking` `transparent` `refresh` |
| `GET /badge.svg` | now-playingカード | `theme` |
| `GET /ranking.svg` | ランキング | `theme` `count` |
| `GET /embed.js` | ワンタグ埋め込み | — |

---

## デプロイ（ライブAPIモードのみ）

DBは不要です。秘密情報はリポジトリに含まれないので、各プラットフォームのシークレット機能で設定します。本番では `CORS_ORIGIN` を自分のサイトのURLに限定することを推奨します。

### Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

同梱の [`render.yaml`](render.yaml) を Blueprint として読み込み、`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REFRESH_TOKEN` を入力します（`sync: false` なので値はリポジトリに保存されません）。`LLM_API_KEY` などは任意です。

値は `npm run setup` を実行したあとの `.env` からコピーできます。

> 無料プランは15分アクセスが無いとスリープします。常に即応させたい場合は [cron-job.org](https://cron-job.org) などで定期的に `/health` を叩いてください。

### Docker（Fly.io / Cloud Run / VPS）

```bash
docker build -t spotify-embedded .
docker run -p 3000:3000 \
  -e SPOTIFY_CLIENT_ID=... -e SPOTIFY_CLIENT_SECRET=... \
  -e SPOTIFY_REFRESH_TOKEN=... -e LLM_API_KEY=... \
  spotify-embedded
```

書き込み可能なボリュームを `/app/data` にマウントすると、環境変数の代わりに `data/auth.json` を使えます。

---

## 設定

| 変数 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `SPOTIFY_CLIENT_ID` | ✓ | — | Spotifyアプリの Client ID |
| `SPOTIFY_CLIENT_SECRET` | ✓ | — | Spotifyアプリの Client Secret |
| `SPOTIFY_REFRESH_TOKEN` | ✓ | — | `npm run setup` が取得 |
| `LLM_API_KEY` | | — | **未設定ならムード文なしで動作します** |
| `LLM_BASE_URL` | | `https://api.groq.com/openai/v1` | OpenAI互換のエンドポイント |
| `LLM_MODEL` | | `llama-3.3-70b-versatile` | 使用モデル |
| `SPOTIFY_REDIRECT_URI` | | `http://127.0.0.1:3000/auth/callback` | Dashboard の登録値と一致させる |
| `PORT` | | `3000` | — |
| `CORS_ORIGIN` | | `*` | 本番では自分のサイトに限定を推奨 |
| `AUTH_STORE_PATH` | | `data/auth.json` | 設定の保存先 |

設定は **環境変数 → `data/auth.json`** の順に解決されます。環境変数が優先なので、すでに `.env` だけで運用している場合は何も変わりません。

`LLM_API_KEY` は `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `GROQ_API_KEY` という名前でも読み取ります。すでにどれかを設定していれば、そのままで動きます。

---

## 設計メモ

### audio-features を使わない理由

Spotifyは2024年11月以降に作成されたアプリで `/audio-features`（テンポ・エネルギー等）を廃止しました。本プロジェクトは代わりに、**アーティストのジャンルタグ**（`/artists`）・**人気度**・**曲名/アーティスト名/アルバム名** をLLMに渡してムードを推論しています。

### 似たプロジェクトとの違い

now-playingをSVGにする先行プロジェクトは複数あります（[spotify-github-profile](https://github.com/kittinan/spotify-github-profile)、[vinilo](https://github.com/icortesb/vinilo) など）。本プロジェクトが違うのは次の点です。

- **AIが日本語で気分を言語化する。** 他は曲名を表示します。ここではムード文が主役で、曲名はその出典として添えられます。
- **GitHub README専用ではない。** ポートフォリオサイトへの埋め込みを主用途に設計しています（ワンタグ、Shadow DOM分離、iframe、テーマ）。
- **データとして使える。** SVGだけでなく、JSON/YAMLの公開スキーマを持ちます。
- **静的とライブが同じスキーマ。** サーバー無しで始めて、必要になったらURLの差し替えだけで移行できます。

---

## ライセンス

MIT

## コントリビューション

開発手順と脆弱性の報告方法は [`CONTRIBUTING.md`](CONTRIBUTING.md) と
[`SECURITY.md`](SECURITY.md) を参照してください。リリースは
`vX.Y.Z` 形式のタグを起点にGitHub Actionsが自動作成します。
