# SpotifyEmbedded

Spotifyで再生中の楽曲をもとに、LLMが推論したムード文（今の気分を表す一言）を生成し、GitHubのREADMEやポートフォリオサイトへ埋め込むためのセルフホスト型ツールです。

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

<p align="center"><sub>上の2枚は、このリポジトリ自身の静的モード（GitHub Actions）が生成した作者のSpotifyデータです。</sub></p>

[![CI](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/ci.yml/badge.svg)](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Sh1n1230/SpotifyEmbedded)](LICENSE)
[![Security Check](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/security.yml/badge.svg)](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/security.yml)

本ツールには「静的モード」と「ライブAPIモード」の2つの動作方式があり、サーバーを常時稼働させない構成でも運用できます。

| | サーバー | リアルタイム性 | 主な用途 |
|---|---|---|---|
| **静的モード** | 不要 | 数十分〜数時間ごと（※） | GitHub README、ブログ、手軽に導入したい場合 |
| **ライブAPIモード** | 必要 | 秒単位 | ポートフォリオサイトで即時反映させたい場合 |

ライブAPIモードが対象とするデータは、リアルタイム更新が必要な再生中情報（now-playing）に限定されます。ランキング情報は数週間から1年単位の集計値であり即時性が求められないため、静的モードでのみ出力します。なお、now-playing のJSONスキーマは両モードで共通しているため、静的モードからライブAPIモードへの移行はデータ取得先URLの変更のみで完了します。

---

## 静的モード（サーバー不要）

GitHub Actions が定期的にSpotify Web APIからデータを取得し、SVG・JSON・HTMLを生成して公開用ブランチへ反映します。常時稼働するサーバーを運用する必要はありません。認証トークンはGitHub Secretsにのみ保管され、公開されるのは楽曲名やアルバムアートのURLなどの生成済みデータに限定されます。

### 1. 準備

本リポジトリをフォークし、ローカル環境へクローンします。

```bash
git clone https://github.com/<username>/SpotifyEmbedded.git
cd SpotifyEmbedded
npm install
```

[Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリケーションを作成し、**Settings → Redirect URIs** に次のURIを登録します。

```
http://127.0.0.1:3000/auth/callback
```

ムード文の生成に用いるLLMプロバイダは自由に選択できます。OpenAIのChat Completions API形式（`POST {baseUrl}/chat/completions`）を受け付けるエンドポイントであれば、任意のサービスを利用できます。セットアップスクリプトには代表的なプロバイダの入力補助が含まれており、一覧にないサービスでもカスタムURLを指定して利用可能です。

| | エンドポイント | 既定モデル | 備考 |
|---|---|---|---|
| **Google Gemini（推奨）** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.1-flash-lite` | 無料枠あり |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | 従量課金 |
| その他 | 任意のOpenAI互換URL | — | — |

> **Gemini を利用する場合の注意**
> OpenAI互換エンドポイントのパスは `/v1beta/openai` です。`/v1beta` や `/v1beta/interactions` を指定した場合は 401 または 404 エラーとなります。
> また、Geminiの推論モデルでは、短いトークン上限を推論思考のみで消費し本文が空になる現象が発生します。本プロジェクトではGemini向けのリクエストに `reasoning_effort: "none"` を自動付与して思考出力を抑止するため、手動での調整は不要です。

プロバイダの選択はセットアップ時にCLIで対話的に指定します。LLMの設定を省略した場合でも、楽曲情報のみでカードが生成されます。

### 2. セットアップ

```bash
npm run setup
```

コマンドを実行するとローカルサーバーが起動し、ブラウザでSpotifyの認可画面が開きます。認証を完了すると、スクリプトが以下の処理を自動で実行します。

- `refresh_token` の取得
- `.env` および `data/auth.json` への保存
- LLMの接続検証（実際に短文を1件生成し、URLやモデル名の指定ミスを即座に検出）
- GitHub Secretsへの登録（`gh` CLI が利用可能な場合は自動登録し、未導入の場合は手動設定用の値を表示）

すでに設定が存在する状態で再実行した場合は、LLM設定の更新確認が表示されます。APIキーの有効期限切れやプロバイダの変更時は、セットアップコマンドを再実行することで、ローカルの設定ファイルとGitHub Secretsの双方を同時に更新できます。

### 3. 有効化

フォークしたリポジトリでは、GitHub Actions がはじめは無効になっています。次の順で有効化してください。

1. **Actions** タブを開き、**I understand my workflows, go ahead and enable them** を押します。フォーク直後はスケジュール実行も止まっているため、これを押さないと定期更新が始まりません。
2. **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選びます（ブランチ指定ではありません。`spotify-data` ブランチの中身は `Deploy GitHub Pages` ワークフローが公開します）。
3. **Actions → Update Spotify snapshot → Run workflow** で初回を手動実行します。成功すると `spotify-data` ブランチが作られ、続けて `Deploy GitHub Pages` が走って公開されます。

以降はGitHub Actionsによってデータが定期的に更新されます（更新間隔の仕様は後述の「更新の間隔について」を参照）。

> 公開リポジトリのスケジュール実行は、リポジトリに60日間アクティビティが無いと GitHub によって自動で無効化されます。止まっていたら Actions タブから再度有効化してください。

### 4. 埋め込みコードの配置

`https://<username>.github.io/SpotifyEmbedded/` 以下に生成物が公開されます。

```markdown
<!-- GitHub README（ダーク/ライト自動切替） -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://<username>.github.io/SpotifyEmbedded/now-playing.svg">
  <img src="https://<username>.github.io/SpotifyEmbedded/now-playing-light.svg" alt="Now Playing">
</picture>
```

```html
<!-- Webサイトへの埋め込み（ホバー表示やSpotifyリンクが動作します） -->
<iframe src="https://<username>.github.io/SpotifyEmbedded/"
        width="500" height="180" frameborder="0" loading="lazy"></iframe>
```

```js
// データとしての利用（ライブAPIと同一スキーマ）
const res = await fetch('https://<username>.github.io/SpotifyEmbedded/now-playing.json');
```

| ファイル | 内容 |
|---|---|
| `now-playing.svg` / `now-playing-light.svg` | ムード文つきカード画像 |
| `ranking.svg` / `ranking-light.svg` | トップトラック（既定: 直近4週間のトップ5）。LLM設定時はランキング全体のムード文を含む |
| `now-playing.json` / `.yaml` | ライブAPIと同一スキーマのJSON/YAML |
| `top-tracks.json` / `.yaml` | ランキングデータ（静的モード限定） |
| `index.html` | iframe用HTMLページ |

楽曲の再生が停止している状態では、Spotifyの再生履歴（`recently-played`）から最後に聴き終えた楽曲を取得して表示します。ワークフローの実行が数時間おきでも、その間に聴いた曲を取りこぼしません。履歴を取得できない場合も、直前の観測結果を `snapshot.json` から引き継ぐため、非再生状態のプレースホルダーにはなりません。

> **v1.2.0 以前からの利用者へ**
> 再生履歴の取得には `user-read-recently-played` スコープが必要で、v1.3.0 で追加しました。以前に発行した `refresh_token` にはこのスコープが含まれないため、`npm run setup` を再実行して再認証してください（GitHub Secrets も同時に更新されます）。再認証しなくても従来どおり動作しますが、停止中の表示は「Actions の実行時にたまたま再生していた曲」のままになります。

> **更新の間隔について**
> ワークフロー定義上は30分間隔でスケジュールを設定していますが、GitHub Actionsの `schedule` トリガーは定刻起動を保証せず、実行の遅延や間引きが発生します。環境や混雑状況によっては更新間隔が2〜5時間程度空く場合があります。また、GitHubによる画像キャッシュ（camoプロキシ）の影響により、README上の表示更新にはさらなる遅延が加わります。
> 手動で即座に更新したい場合は、GitHub上の **Actions → Update Spotify snapshot → Run workflow** を実行してください。秒単位での即時反映が必要な場合は、後述のライブAPIモードを利用します。

### ローカル環境での生成

GitHub Actionsを利用せず、ローカル環境で直接静的ファイルを生成することもできます。

```bash
npm run generate                      # ./out に出力
npm run generate -- --out ./public --count 10 --theme dark
npm run generate -- --range medium_term --limit 30 --count 10
npm run generate -- --no-mood         # LLM設定なしで実行
```

| オプション | 既定値 | 説明 |
|---|---|---|
| `--out <dir>` | `./out` | 出力先ディレクトリ |
| `--range <name>` | `short_term` | 集計期間（[ランキングの集計期間](#ランキングの集計期間)） |
| `--limit <n>` | `50` | Spotify から取得する件数（`10` / `30` / `50`） |
| `--count <n>` | `5` | ランキングの表示件数（1〜50） |
| `--theme <name>` | `both` | テーマ指定（`dark` / `light` / `both`） |
| `--no-mood` | — | AIムード文の生成をスキップ |

出力ファイル名は集計期間によらず共通（`ranking.svg` / `top-tracks.json`）です。指定した集計期間は JSON/YAML の `range` フィールドに記録されます。GitHub Actions では手動実行（Run workflow）時に期間と件数を指定できます。

### ランキングの集計期間

Spotify Web API の仕様により、指定可能な集計期間は以下の3つのプリセットに限定されます（「3か月」などの任意の月数は指定できません）。

| 値 | 期間の目安 |
|---|---|
| `short_term` | 直近約4週間（既定値） |
| `medium_term` | 直近約6か月 |
| `long_term` | 直近約1年 |

---

## ライブAPIモード

再生中の楽曲情報を秒単位でリアルタイムに反映したい場合は、常時稼働サーバー（Node.js または Cloudflare Workers）を利用するライブAPIモードを選択します。ライブAPIモードは now-playing（再生中情報）のエンドポイントのみを提供します。ランキング情報が必要な場合は、静的モードで生成した `ranking.svg` または `top-tracks.json` を利用してください。

```bash
npm run setup      # 初期設定が未完了の場合
npm run dev        # http://localhost:3000
```

### 埋め込み方

**JavaScript埋め込み（推奨）**：Webサイトの既存CSSとのスタイル干渉を防ぐため、カードコンポーネントはShadow DOM内部に描画されます。

```html
<div id="spotify"></div>
<script src="https://your-api.example.com/embed.js"
        data-target="#spotify"
        data-theme="dark"
        data-refresh="30"></script>
```

| 属性 | 既定値 | 説明 |
|---|---|---|
| `data-target` | (スクリプトの直後) | 描画先のCSSセレクタ |
| `data-theme` | `dark` | テーマ（`dark` / `light`） |
| `data-transparent` | `false` | `true` で背景を透過 |
| `data-refresh` | `30` | 更新間隔（秒、最小値10） |

**iframe**

```html
<iframe src="https://your-api.example.com/embed?theme=dark"
        width="500" height="180" frameborder="0"></iframe>
```

**SVG画像**（GitHub README等への埋め込み用）

```markdown
![Now Playing](https://your-api.example.com/badge.svg)
```

**JSONデータ取得**（クライアント側での加工用）

```js
const res = await fetch('https://your-api.example.com/api/now-playing');
const data = await res.json();
if (data.is_playing) {
  console.log(data.mood.text);           // "ダークな気分に浸っているようです"
  console.log(data.track.name);          // "Armed And Dangerous"
  console.log(data.track.album_art_url); // アルバムアートのURL
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
    "popularity": null,
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

> **`popularity` / `preview_url` / `genres` について**
> Spotify側の仕様変更により、2024年11月以降に作成された開発者アプリケーションではこれらの項目がAPIから返却されません（アーティスト情報のバッチ取得 `/artists?ids=` は 403 Forbidden となります）。スキーマの後方互換性を保つためレスポンス内のキーは維持されますが、`popularity` と `preview_url` は常に `null`、`genres` は空配列となります。詳細な背景は[設計メモ](#audio-features-を使わない理由)を参照してください。

### ランキング（`top-tracks.json`、静的モードのみ）

このデータはライブAPIモードのエンドポイントとしては提供されず、静的モードでのみ `top-tracks.json` および `.yaml` として出力されます。各楽曲オブジェクトには `rank` と `genres` が付与されます。LLMが設定されている場合は、ランキング全体の傾向を表す `mood`（例: `"最近は夜に似合う曲ばかり聴いているようです"`）も記録されます（未設定時は `mood: null`）。

`mood` は上位10曲の構成が大きく変化したときに限り再生成を行うキャッシュ制御を設けているため、`mood.generated_at`（ムード文生成日時）は `fetched_at`（データ取得日時）より過去の時刻を指す仕様となっています（詳細は[設計メモ](#ランキングのムード文を毎回作らない理由)を参照）。集計期間と件数は `generate` コマンドの `--range` および `--limit` オプションで指定します（[ランキングの集計期間](#ランキングの集計期間)）。

### 埋め込み用エンドポイント

| パス | 内容 | クエリパラメータ |
|---|---|---|
| `GET /embed` | iframe用HTML | `theme` `transparent` `refresh` |
| `GET /badge.svg` | now-playingカード画像 | `theme` |
| `GET /embed.js` | JavaScript埋め込みスクリプト | — |

---

## デプロイ（ライブAPIモードのみ）

データベースの用意は不要です。認証情報などの秘密情報はリポジトリに含めず、各ホスティングサービスのシークレット管理機能で設定します。本番運用時はセキュリティのため、`CORS_ORIGIN` を自身のWebサイトのオリジンに限定することを推奨します。

### Cloudflare Workers（推奨・無料）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Sh1n1230/SpotifyEmbedded)

Cloudflare Workersの無料プラン（1日最大10万リクエスト）の範囲内で運用できます。常時待機しておりインスタンスのスリープが発生しないため、GitHub READMEに画像を埋め込んだ際にも、起動遅延に伴う画像プロキシ（camo）のタイムアウトを回避できます。

```bash
npx wrangler login
npm run deploy                                   # 初回デプロイ時にムード文保存用のKVネームスペースが自動生成されます
npx wrangler secret put SPOTIFY_CLIENT_ID        # プロンプトに従って各値を設定
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put SPOTIFY_REFRESH_TOKEN
npx wrangler secret put LLM_API_KEY              # 任意（LLM_BASE_URL / LLM_MODEL / CORS_ORIGIN も同様）
```

`npm run setup` を実行済みの場合は、`npx wrangler secret bulk .env` で一括登録できます。

デプロイ先URLは `https://spotify-embedded.<subdomain>.workers.dev` です。設定内容は [`wrangler.jsonc`](wrangler.jsonc) に記述されています。ローカル環境でWorkersとして動作確認を行うには、`.dev.vars.example` を `.dev.vars` にコピーして `npm run dev:worker` を実行します。

- 楽曲ごとのムード文はWorkers KVに永続化します。Workersの実行インスタンスはリクエスト終了後に破棄されやすいため、インメモリキャッシュのみでは同一楽曲に対するLLMの重複呼び出しを防げません。
- Workers環境ではファイルシステムが利用できないため、`data/auth.json` は読み込めません。設定値はすべてWranglerのシークレット機能で環境変数として設定します。
- 認証用エンドポイント（`npm run auth` / `/auth/*`）はローカル実行専用です。セキュリティ上、Workers環境では有効化しないでください。

### Docker（Fly.io / Cloud Run / VPS）

```bash
docker build -t spotify-embedded .
docker run -p 3000:3000 \
  -e SPOTIFY_CLIENT_ID=... -e SPOTIFY_CLIENT_SECRET=... \
  -e SPOTIFY_REFRESH_TOKEN=... -e LLM_API_KEY=... \
  spotify-embedded
```

永続ボリュームを `/app/data` にマウントすることで、環境変数の代わりに `data/auth.json` による設定管理も可能です。

---

## 設定

| 変数 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `SPOTIFY_CLIENT_ID` | ✓ | — | Spotifyアプリの Client ID |
| `SPOTIFY_CLIENT_SECRET` | ✓ | — | Spotifyアプリの Client Secret |
| `SPOTIFY_REFRESH_TOKEN` | ✓ | — | `npm run setup` が取得したリフレッシュトークン |
| `LLM_API_KEY` | | — | 未設定時はムード文なしで動作 |
| `LLM_BASE_URL` | | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI互換のエンドポイント |
| `LLM_MODEL` | | `gemini-3.1-flash-lite` | 使用モデル |
| `SPOTIFY_REDIRECT_URI` | | `http://127.0.0.1:3000/auth/callback` | Dashboard の登録値と一致させる |
| `PORT` | | `3000` | サーバーの待受ポート |
| `CORS_ORIGIN` | | `*` | 許可するオリジン（本番では埋め込み先サイトに限定を推奨） |
| `AUTH_STORE_PATH` | | `data/auth.json` | 認証情報の保存先 |

設定値は **環境変数 → `data/auth.json`** の優先順位で解決されます。環境変数が優先されるため、`.env` ファイルのみで設定を行っている既存の構成にもそのまま適用されます。

`LLM_API_KEY` は `OPENAI_API_KEY`、`OPENROUTER_API_KEY`、`GEMINI_API_KEY`、`GOOGLE_API_KEY` の各環境変数名にも対応しています。これらのいずれかが定義されている場合は、追加の設定なしで自動的に読み込まれます。

---

## 設計メモ

### audio-features を使わない理由

Spotify Web APIでは、2024年11月以降に作成された開発者アプリケーションに対して `/audio-features`（テンポやエネルギーなどの楽曲特徴量エンドポイント）の提供を終了しました。本プロジェクトではこれに代わり、アーティストのジャンル情報（`/artists`）、人気度（`popularity`）、および楽曲名・アーティスト名・アルバム名をLLMへ与えてムード文を推論する構成としています。

ただしAPIのアクセス制限は拡大しており、現在新規作成されたアプリケーションでは `genres` と `popularity` の取得も制限されています（`/artists?ids=` のバッチ取得は 403 Forbidden が返り、単体取得でも `genres` フィールドが除外されます）。extended quota mode が承認された一部のアプリケーションでは現在も返却されるため機能自体は維持していますが、実行プロセス内で一度 403 エラーを検知した場合は以降のリクエストを抑止し、不要なHTTP往復の発生を防いでいます。

したがって多くの環境において、ムード推論の入力として実際に利用されるのは楽曲名・アーティスト名・アルバム名の3項目となります。取得できなかった項目はプロンプトから該当行を除外しています（「不明」などの欠損表現をプロンプトに含めると、生成されるムード文がその語彙に引きずられるためです）。

### ランキングのムード文を毎回作らない理由

ランキング情報は数週間から1年の長期間を集計対象とするため、データ取得ごとにLLMを呼び出すと、ほぼ同一の入力に対して無駄なAPIコストが発生します。一方で一般的なTTL（有効期間、例: 24時間）によるキャッシュ制御では、上位楽曲に変化がない場合でも期限切れに伴う無駄な再生成が走り、逆に短時間で上位楽曲が大きく変動した場合でも期限までは古いムード文が維持されてしまいます。いずれの問題も、キャッシュの失効判定を「時間経過」に依存していることに起因します。

そこで本ツールでは、ムード文のキャッシュ失効を「ランキングの構成楽曲」に連動させています。

- 生成時点の上位10曲のIDを、生成根拠としてムード文とともに記録します。
- 最新の上位10曲のうち、前回の生成根拠に含まれていなかった新規楽曲が4曲以上に達した段階で再生成を行います（同一楽曲内の順位変動はトリガーとしません）。
- 比較対象は「直前の取得データ」ではなく「現行ムード文を生成した時点の構成」です。1曲ずつの緩やかな変化であっても、変化が累積すれば確実に再生成が実行されます。
- この生成根拠は `snapshot.json` に保存し、GitHub Actions の実行をまたいで保持されます（判定ロジックは `src/core/rankingMood.ts`）。
- LLM呼び出しの失敗などによって再生成が行えなかった場合は既存のムード文を維持し、次回の更新サイクルで再試行します。

### 似たプロジェクトとの違い

再生中の楽曲情報をSVGカード化する先行プロジェクトは複数存在します（[spotify-github-profile](https://github.com/kittinan/spotify-github-profile)、[vinilo](https://github.com/icortesb/vinilo) など）。本プロジェクトが持つ主な相違点は以下のとおりです。

- **日本語によるムード文の自動生成**：再生中の楽曲特徴やタイトルから推論したムード文を一言で提示し、楽曲名やアルバム名はムード文の根拠（出典）として配置します（先行ツールの多くは楽曲情報の単なる表示にとどまります）。
- **Webサイトへの埋め込みを主眼とした設計**：GitHub READMEへの画像埋め込みだけでなく、ポートフォリオサイト等への組み込みを前提に設計されています（Shadow DOMによるスタイル隔離、JavaScript埋め込みタグ、iframe、各種テーマ対応）。
- **データとしての再利用性**：表示用SVGの出力に加え、外部プログラムから利用可能なJSONおよびYAMLの公開スキーマを提供します。
- **動作モード間でのスキーマ統一**：サーバー不要の静的モードとリアルタイムなライブAPIモードで出力JSONのスキーマを統一しています。運用の初期段階では静的モードを採用し、後からライブAPIモードへ移行する場合でも、データ取得先URLを変更するだけで対応できます。

---

## ライセンス

MIT

## コントリビューション

開発手順と脆弱性の報告方法は [`CONTRIBUTING.md`](CONTRIBUTING.md) と
[`SECURITY.md`](SECURITY.md) を参照してください。リリースは
`vX.Y.Z` 形式のタグを起点にGitHub Actionsが自動作成します。
