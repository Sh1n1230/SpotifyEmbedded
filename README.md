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
[![Update Spotify snapshot](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/update-spotify.yml/badge.svg)](https://github.com/Sh1n1230/SpotifyEmbedded/actions/workflows/update-spotify.yml)

本ツールには「静的モード」と「ライブAPIモード」の2つの動作方式があり、サーバーを常時稼働させない構成でも運用できます。

| | サーバー | リアルタイム性 | 必要なアカウント | 費用の目安 | 主な用途 |
|---|---|---|---|---|---|
| **静的モード** | 不要 | 数十分〜数時間ごと（※） | GitHub・Spotify | 公開リポジトリなら無料（LLM は下記） | GitHub README、ブログ、手軽に導入したい場合 |
| **ライブAPIモード** | 必要 | 秒単位 | Spotify と Cloudflare（または Docker を動かす場所） | Workers の無料枠で動く（LLM は下記） | ポートフォリオサイトで即時反映させたい場合 |

どちらも、ムード文を使うなら LLM の API キーが要ります（Gemini などの無料枠で足ります。無くても動きます）。

ライブAPIモードが対象とするデータは、リアルタイム更新が必要な再生中情報（now-playing）に限定されます。ランキング情報は数週間から1年単位の集計値であり即時性が求められないため、静的モードでのみ出力します。なお、now-playing のJSONスキーマは両モードで共通しているため、静的モードからライブAPIモードへの移行はデータ取得先URLの変更のみで完了します。

**目次**: [静的モード](#静的モードサーバー不要) ・ [ライブAPIモード](#ライブapiモード) ・ [両方を使う](#静的モードとライブapiを両方使う) ・ [APIリファレンス](#apiリファレンス) ・ [デプロイ](#デプロイライブapiモードのみ) ・ [設定](#設定) ・ [ムード文が出ないとき](#トラブルシューティング-ムード文が出ない) ・ [設計メモ](#設計メモ)

---

## 静的モード（サーバー不要）

GitHub Actions が定期的にSpotify Web APIからデータを取得し、SVG・JSON・HTMLを生成して公開用ブランチへ反映します。常時稼働するサーバーを運用する必要はありません。認証トークンはGitHub Secretsにのみ保管され、公開されるのは楽曲名やアルバムアートのURLなどの生成済みデータに限定されます。

### 1. 準備

Node.js 22 以上（`package.json` の `engines`。`.nvmrc` の版を推奨）が必要です。本リポジトリをフォークし、ローカル環境へクローンします。

```bash
git clone https://github.com/<username>/SpotifyEmbedded.git
cd SpotifyEmbedded
npm ci --ignore-scripts
```

[Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリケーションを作成し（使う API を聞かれたら **Web API** を選びます）、**Settings → Redirect URIs** に次のURIを登録します。

```
http://127.0.0.1:3000/auth/callback
```

`localhost` は登録できません。Spotify は Redirect URI の http をループバックの IP アドレスの明示（`127.0.0.1` か `[::1]`）に限っています（[Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)）。

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

> **refresh_token は承認から6か月で失効します**
> Spotify の refresh_token は、使い続けていても承認から6か月で使えなくなります（[Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)）。`npm run setup` の完了時に取り直しの目安の日付を表示するので、その日までに `npm run setup` を再実行してください（GitHub Secrets も同時に更新されます。Workers を使っている場合は `wrangler secret` も更新します）。

#### トラブルシューティング: `invalid_grant`

`Update Spotify snapshot` が毎回失敗する、またはライブAPIが 502（`/badge.svg` と `/embed` は「取得できませんでした」）を返し、ログに `invalid_grant` と出る場合は、refresh_token が失効または取り消されています（6か月の期限切れ、Spotify のアプリ連携の解除、Client Secret の再発行など）。`npm run setup` で取り直して登録し直してください。静的モードのカードは、その間も最後に成功した時点の内容のまま残ります。

新しい refresh_token は、使っている場所すべてに反映します。

| 実行環境 | 反映の方法 |
|---|---|
| 静的モード（GitHub Actions） | `gh` があれば `npm run setup` が更新します。無ければ **Settings → Secrets and variables → Actions** で `SPOTIFY_REFRESH_TOKEN` を更新し、**Run workflow** で確かめます |
| Cloudflare Workers | `npx wrangler secret put SPOTIFY_REFRESH_TOKEN` |
| Docker | `.env` か `data/auth.json` を更新してコンテナを起動し直します（各ホストのシークレットを使っているなら、そちらを更新します） |

#### トラブルシューティング: 認可の後に 403 になる

新しく作った Spotify アプリは Development Mode で、Dashboard の **User Management** に登録したユーザーしか使えません（[Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)）。アプリを作ったアカウントと聴いているアカウントが違う場合は、聴いているアカウントを登録してください。

#### トラブルシューティング: ムード文が出ない

曲の情報は出ているのにムード文だけが無いときは、ログ（Actions の `Update Spotify snapshot` の実行ログ・`wrangler tail`・コンテナのログ）に `[mood] ムード文を省略しました:` で始まる行が出ています。

| ログのメッセージ | 原因と直し方 |
|---|---|
| `LLMのAPIキーが拒否されました` | `LLM_API_KEY` の誤りか失効です。キーを発行し直します |
| `モデル "…" が見つかりません` | `LLM_MODEL` と `LLM_BASE_URL` の組み合わせを確かめます |
| `LLM がリクエストを受け付けませんでした` | そのモデルが送り先で使えるかを確かめます |
| `LLM_MODEL が設定されていません` | プリセットに無い送り先では `LLM_MODEL` が必須です |
| `API キーが平文で送られるため…` | `LLM_BASE_URL` を `https://` にします（`http://` はローカルだけ） |
| `LLMへのリクエストがタイムアウトしました` | 一時的なら次の回に作り直されます。続くなら送り先の状態を確かめます |
| `ムード文として採れない出力でした` | モデルの出力が長すぎるか、使えない文字を含んでいます。別のモデルを試します |

### 3. 有効化

フォークしたリポジトリでは、GitHub Actions がはじめは無効になっています。次の順で有効化してください。

1. **Actions** タブを開き、**I understand my workflows, go ahead and enable them** を押します。フォーク直後はスケジュール実行も止まっているため、これを押さないと定期更新が始まりません。
2. **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選びます（ブランチ指定ではありません。`spotify-data` ブランチの中身は `Deploy GitHub Pages` ワークフローが公開します）。
3. **Actions → Update Spotify snapshot → Run workflow** で初回を手動実行します。成功すると `spotify-data` ブランチが作られ、続けて `Deploy GitHub Pages` が走って公開されます。

以降はGitHub Actionsによってデータが定期的に更新されます（更新間隔の仕様は後述の「更新の間隔について」を参照）。

> 公開リポジトリのスケジュール実行は、リポジトリに60日間アクティビティが無いと GitHub によって自動で無効化されます。止まっていたら Actions タブから再度有効化してください。

### 4. 埋め込みコードの配置

`https://<username>.github.io/SpotifyEmbedded/` 以下に生成物が公開されます。`SpotifyEmbedded` の部分はリポジトリ名です。リポジトリ名を変えた場合や `<username>.github.io` のリポジトリに入れた場合は、**Settings → Pages** に表示される URL を使ってください。

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
        title="Spotify で最後に聴いた曲"
        width="500" height="180" style="border: 0" loading="lazy"></iframe>

<!-- 明るい背景のサイトにはライトテーマ版（--theme both の既定のとき。--theme light では index.html） -->
<iframe src="https://<username>.github.io/SpotifyEmbedded/index-light.html"
        title="Spotify で最後に聴いた曲"
        width="500" height="180" style="border: 0" loading="lazy"></iframe>
```

> iframe 用のページにはカードの下にランキングも描かれます。`height="180"` ではカードだけが見え、ランキングはスクロールしないと見えません。ランキングまで見せるときの高さの目安は `260 + 57 × 件数`（ムード文があれば約 30 足す）です。

```js
// データとしての利用（ライブAPIと同一スキーマ）
const res = await fetch('https://<username>.github.io/SpotifyEmbedded/now-playing.json');
```

| ファイル | 内容 |
|---|---|
| `now-playing.svg` / `now-playing-light.svg` | ムード文つきカード画像 |
| `ranking.svg` / `ranking-light.svg` | トップトラック（既定: 直近4週間のトップ5）。LLM設定時はランキング全体のムード文を含む |
| `now-playing.json` / `.yaml` | ライブAPIと同一スキーマのJSON/YAML |
| `last-played.json` / `.yaml` | カード画像と同じ「最後に聴いた曲」（`track` / `mood` / `played_at`）。静的モード限定 |
| `top-tracks.json` / `.yaml` | ランキングデータ（静的モード限定） |
| `index.html` / `index-light.html` | iframe用HTMLページ（ダーク / ライト） |
| `robots.txt` | 検索エンジンに載せないための指定（`--index` を付けると書かない。下の「検索エンジンへの掲載」） |

JSON の形は [JSON Schema](schema/)（`now-playing.schema.json`・`top-tracks.schema.json`・`last-played.schema.json`）で検証できます。YAML も同じ形です。

`snapshot.json` は次の実行へ状態を持ち越すための内部のファイルで、`spotify-data` ブランチには置かれますが、GitHub Pages には公開しません。形は予告なく変わるので、データとして使うときは上の表のファイルを参照してください。

YAML（`now-playing.yaml`・`last-played.yaml`・`top-tracks.yaml`）は、YAML をデータとして読める静的サイトジェネレーター向けです。たとえば Hugo や Jekyll では、ビルドの前にデータのフォルダへ取得しておくと、テンプレートから参照できます。

```bash
# Hugo: data/spotify.yaml として置くと、テンプレートで {{ .Site.Data.spotify.track.name }} と書ける
curl -fsS -o data/spotify.yaml https://<username>.github.io/SpotifyEmbedded/last-played.yaml
# Jekyll: _data/spotify.yaml として置くと {{ site.data.spotify.track.name }}
curl -fsS -o _data/spotify.yaml https://<username>.github.io/SpotifyEmbedded/last-played.yaml
```

カードの見出しの時刻（`NOW PLAYING · 10/16 21:04`・`LAST PLAYED · 10/16 21:04`）は**日本時間**です（表示は日本語向けのため固定しています）。生成した年と違う年の曲には年が付きます（`LAST PLAYED · 2025/10/16 21:04`）。静的モードは数時間おきの生成なので、再生中のカードにも「いつの情報か」を出しています。

**検索エンジンへの掲載**: 既定では、聴いている曲が検索結果に出ないよう、`index.html` に `noindex` を入れ、`robots.txt`（`Disallow: /`）を書きます。ただし `robots.txt` はホストの直下でだけ効くため、GitHub Pages のプロジェクトサイト（`<username>.github.io/SpotifyEmbedded/`）では効きません（独自ドメインや `<username>.github.io` のリポジトリでは効きます）。JSON・SVG には `noindex` を入れられないので、URL がどこかからリンクされると検索エンジンに拾われることがあります。載せてよい場合は `--index` を付けます。

楽曲の再生が停止している状態では、Spotifyの再生履歴（`recently-played`）から最後に聴き終えた楽曲を取得して表示します。ワークフローの実行が数時間おきでも、その間に聴いた曲を取りこぼしません。履歴を取得できない場合も、直前の観測結果を `snapshot.json` から引き継ぐため、非再生状態のプレースホルダーにはなりません。

`now-playing.json` はライブAPIと同じく生成時点の再生状況そのものなので、停止中は `track: null` になります。カード画像と同じ曲をデータとして使う場合は `last-played.json` を参照してください。

- 再生中: 再生中の曲。`played_at` は取得時刻
- 停止中: 最後に聴いた曲。`played_at` は聴き終えた時刻（再生履歴から取得した場合）、または前回の実行で再生中と確認した時刻（引き継いだ場合）
- 再生履歴も前回データも無い場合: `{ "track": null, "mood": null, "played_at": null }`

> **v1.2.0 以前からの利用者へ**
> 再生履歴の取得には `user-read-recently-played` スコープが必要で、v1.3.0 で追加しました。以前に発行した `refresh_token` にはこのスコープが含まれないため、`npm run setup` を再実行して再認証してください（GitHub Secrets も同時に更新されます）。再認証しなくても従来どおり動作しますが、停止中の表示は「Actions の実行時にたまたま再生していた曲」のままになります。

> **更新の間隔について**
> ワークフロー定義上は30分間隔でスケジュールを設定していますが、GitHub Actionsの `schedule` トリガーは定刻起動を保証せず、実行の遅延や間引きが発生します。環境や混雑状況によっては更新間隔が2〜5時間程度空く場合があります。また、GitHubによる画像キャッシュ（camoプロキシ）の影響により、README上の表示更新にはさらなる遅延が加わります。
> 手動で即座に更新したい場合は、GitHub上の **Actions → Update Spotify snapshot → Run workflow** を実行してください。秒単位での即時反映が必要な場合は、後述のライブAPIモードを利用します。
> `schedule` の最短の間隔は5分です。公開リポジトリの Actions は無料ですが、非公開リポジトリでは無料枠の分数を使います（30分おきで月に約1,440回。[About billing for GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)）。
> README の画像のキャッシュをすぐ消したいときは、ページの HTML で画像の `camo.githubusercontent.com/...` の URL を調べて `curl -X PURGE <その URL>` を送ります（[About anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)）。

### ローカル環境での生成

GitHub Actionsを利用せず、ローカル環境で直接静的ファイルを生成することもできます。先に `npm run setup` を済ませておいてください（`.env` か `data/auth.json` の Spotify の設定を使います）。

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
| `--count <n>` | `5` | ランキングの表示件数（1〜50）。`--limit` を超える指定はエラーになります |
| `--page-count <n>` | `--count` と同じ | iframe 用ページ（`index.html`）のランキングの表示件数（1〜50）。README 用の SVG は5件、サイト用のページは10件、のように分けられます |
| `--theme <name>` | `both` | テーマ指定（`dark` / `light` / `both`） |
| `--no-mood` | — | AIムード文の生成をスキップ（保存済みのランキングのムード文は消さず、次の通常の実行で使い回します） |
| `--refresh-ranking-mood` | — | ランキングのムード文を、顔ぶれの変化に関係なく作り直す |
| `--index` | — | 検索エンジンに載せてよい（`noindex` と `robots.txt` を書かない） |

値は `--out ./public` と `--out=./public` のどちらの形でも渡せます。

`--limit` を `10` / `30` / `50` の3つに限っているのは意図したものです。見せる件数は `--count`・`--page-count` で自由に決められるので取得件数を細かく刻む必要が無く、最小を 10 にすることでランキングのムード文の根拠（上位10曲）が `--limit` に依らず揃います。

ランキングの取得だけが失敗した回（Spotify の一時的な障害など）は、再生状況のファイルを更新し、ランキングのファイル（`ranking*.svg`・`top-tracks.*`）は前回のまま残します。中身が前回と同じファイルは書き直しません。ランキング SVG のジャケ写は、表示件数が 10 件までなら高解像度の画面でもぼやけない 300px 版、それより多ければ SVG が大きくなりすぎないよう 64px 版を焼き込みます。

`--theme` によって、書き出すファイルの名前が次のように変わります（ライトだけのときは、iframe 用のページを `index.html` に書きます）。

| `--theme` | カード画像 | iframe 用のページ |
|---|---|---|
| `both`（既定） | `now-playing.svg`・`now-playing-light.svg`（`ranking` も同じ） | `index.html`（ダーク）・`index-light.html`（ライト） |
| `dark` | `now-playing.svg`・`ranking.svg` | `index.html` |
| `light` | `now-playing-light.svg`・`ranking-light.svg` | `index.html`（ライト） |

ランキング SVG の高さは内容で変わります（`50 + 件数 × 56 + 12`。ムード文があれば行数ごとに 22 と余白の 6 を足します）。README に `width` だけで貼ると、`--count` やムード文の行数で周りの位置が変わります。

出力ファイル名は集計期間によらず共通（`ranking.svg` / `top-tracks.json`）です。指定した集計期間は JSON/YAML の `range` フィールドに記録されます。GitHub Actions では手動実行（Run workflow）時に期間と件数を指定できます。

定期実行の期間と件数を変えたいときは、ワークフローのファイルを書き換えずに、リポジトリの **Settings → Secrets and variables → Actions → Variables** に `RANKING_RANGE`（`short_term` / `medium_term` / `long_term`）と `RANKING_COUNT`（1〜50）を登録します。優先順位は「手動実行の入力 > Variables > 既定値（`short_term`・`5`）」です。

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
npm run dev        # http://127.0.0.1:3000
```

レート制限は、Node.js 版・Cloudflare Workers 版ともに IP ごとに 60 秒あたり 100 リクエストが目安です（`/health` は対象外。IPv6 は /64 単位で数えます）。超えると `/api/now-playing` は 429 と `Retry-After` を返し、`/badge.svg` と `/embed` は「取得できませんでした」のカードを返します（理由は `X-Spotify-Embedded-Error: rate_limited` ヘッダー）。Workers 版は拠点ごとの近似カウントのため、厳密な上限ではありません（別の拠点から来るアクセスは別々に数えられ、上限を超えても通ることがあります）。

| | Node.js 版 | Cloudflare Workers 版 |
|---|---|---|
| 数え方 | プロセスのメモリで厳密に数える | [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) の拠点ごとの近似 |
| `RateLimit-Limit`・`RateLimit-Remaining`・`RateLimit-Reset` | 付く（上限・残り回数・窓が明けるまでの秒数） | 付かない（残り回数が分からないため） |
| `Retry-After`（429 のとき） | 窓が明けるまでの秒数 | 常に 60 |

> **聴いている曲は誰にでも見えます**
> `/api/now-playing` に認証はなく、URL を知っている人は誰でも、曲名・アーティスト・アルバム・ジャケ写・再生中かどうか・ムード文を確かめられます（静的モードの公開ファイルも同じです）。

> **公開範囲とコストについて**
> `CORS_ORIGIN` が未設定（`*`）のままだと、どのサイトからでもこの API を呼べます。他人のサイトに埋め込まれると、自分の Spotify の利用枠と、ムード文を生成する LLM の利用料を使われます。本番では埋め込み先のオリジンに限ってください（カンマ区切りで複数書けます）。本番相当（`NODE_ENV=production`・Workers）で `*` のまま起動すると警告を出します。

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
| `data-theme` | `dark` | テーマ（`dark` / `light` / `auto`）。`auto` は閲覧者の OS のダーク・ライトの設定に合わせます |
| `data-max-width` | `460` | カードの最大幅（px、240〜1920）。`full` で親の幅いっぱいに広げます |
| `data-transparent` | `false` | `true` で背景を透過 |
| `data-refresh` | `30` | 更新間隔（秒、10〜3600） |

**iframe**

```html
<iframe src="https://your-api.example.com/embed?theme=dark"
        title="Spotify で再生中の曲"
        width="500" height="180" style="border: 0" loading="lazy"></iframe>
```

**SVG画像**（GitHub README等への埋め込み用）

背景は透過で、既定はダークテーマの文字色です。GitHub のライトテーマでも読めるよう、静的モードと同じく `<picture>` で切り替えます。

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://your-api.example.com/badge.svg">
  <img src="https://your-api.example.com/badge.svg?theme=light" alt="Now Playing">
</picture>
```

**JSONデータ取得**（クライアント側での加工用）

```js
const res = await fetch('https://your-api.example.com/api/now-playing');
const data = await res.json();
if (data.is_playing) {
  console.log(data.mood?.text ?? '(ムード文なし)'); // "ダークな気分に浸っているようです"
  console.log(data.track.name);          // "Armed And Dangerous"
  console.log(data.track.album_art_url); // アルバムアートのURL
}
```

LLM が未設定の場合やムード文の生成に失敗した場合は、再生中でも `mood` が `null` になります。曲情報はそのまま利用できます。

ライブAPIは、曲が変わった直後のムード文の生成を最大5秒だけ待ちます。間に合わなければ `mood: null` で応答し、生成は続けて、次の取得（既定で30秒後）から載せます。遅い LLM のために曲情報や README の画像が遅れないようにするためです。

`/embed` と `embed.js` は、取得の失敗が3回続くと、前の曲を「NOW PLAYING」のまま出し続けずに「UNAVAILABLE」の表示に切り替えます（取得できるようになれば元に戻ります）。

`album_art_url` は 300px 以上の最大サイズ（通常は 640px 版）です。小さく表示するときは、URL のパスの `ab67616d0000b273`（640px）を `ab67616d00001e02`（300px）か `ab67616d00004851`（64px）に置き換えると、そのサイズの画像を取得できます。

---

## APIリファレンス

`GET /api/now-playing` は JSON（デフォルト）と YAML（`?format=yaml` または `Accept: application/yaml`）に対応しています。エラー応答は常に JSON です。YAML は登録済みのメディアタイプ `application/yaml`（RFC 9512）で返すので、多くのブラウザでは表示されずにダウンロードになります。中身を確かめるときは `curl 'https://your-api.example.com/api/now-playing?format=yaml'` を使ってください。

成功の応答は `Cache-Control: public, max-age=0, must-revalidate`（保存してよいが、使う前に必ず問い合わせる）、エラーの応答は `Cache-Control: no-store` です。応答の形は [JSON Schema](schema/now-playing.schema.json) で検証できます。

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

再生していない場合は `is_playing: false`、`track: null`、`mood: null` を返します。時刻（`fetched_at`・`mood.generated_at`）はすべて UTC の ISO 8601（`Z` 付き）です。

> **`popularity` / `preview_url` / `genres` について**
> Spotify側の仕様変更により、2024年11月以降に作成された開発者アプリケーションではこれらの項目がAPIから返却されません（アーティスト情報のバッチ取得 `/artists?ids=` は 403 Forbidden となります）。スキーマの後方互換性を保つためレスポンス内のキーは維持されますが、`popularity` と `preview_url` は常に `null`、`genres` は空配列となります。詳細な背景は[設計メモ](#audio-features-を使わない理由)を参照してください。

#### エラー応答

エラーの本文は `{ "error": "<人向けの文>", "code": "<機械向けのコード>" }` です。`error` の文は変わることがあるので、分岐には `code` を使ってください。

| ステータス | `code` | `error`（とその他のキー） | 意味 |
|---|---|---|---|
| 429 | `rate_limited` | `Too many requests, please try again later.` | このAPIのレート制限（`Retry-After` つき）。送る頻度を下げてください |
| 503 | `spotify_rate_limited` | `Spotify rate limit exceeded`・`retry_after: N` | サーバーが Spotify のレート制限に達した（`Retry-After` つき）。利用者が送りすぎたわけではないので 429 ではなく 503 です。`Retry-After` の間、サーバーは Spotify を呼びません |
| 503 | `not_configured` | `Server is not configured. See server logs.` | サーバーに必須の設定（Secrets）が無い。運用者がログを確かめてください |
| 502 | `spotify_auth_failed` | `Spotify authentication failed. ...` | refresh_token の失効など。設定を直すまで、サーバーはトークンの更新を再試行しません |
| 502 | `spotify_error` | `Spotify API request failed`・`spotify_status: N` | Spotify の失敗 |
| 502 | `spotify_unreachable` | `Could not reach Spotify` | Spotify に接続できない |
| 504 | `spotify_timeout` | `Spotify API timed out` | Spotify の時間切れ |
| 404 | `not_found` | `Not found` | 未定義のパス |
| 400 | `bad_request` | （理由） | リクエストの誤り |
| 500 | `internal_error` | `Internal server error` | 想定外のエラー |

`/badge.svg` と `/embed` は JSON を返せないので、`X-Spotify-Embedded-Error` ヘッダーで示します（下記）。`rate_limited` は上の `rate_limited` に、`spotify_unavailable` はそれ以外のすべてに対応します。

Node 版は、残りの回数をレート制限のヘッダーで返します。`RateLimit-Policy: "default";q=100;w=60` と `RateLimit: "default";r=42;t=37` は現行の草案（[draft-ietf-httpapi-ratelimit-headers-11](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)）の形で、`RateLimit-Limit`・`RateLimit-Remaining`・`RateLimit-Reset` は draft-03 以前の形です（移行のために併記しています）。これらと `Retry-After`・`X-Spotify-Embedded-Error` は `Access-Control-Expose-Headers` に含めているので、他のオリジンの JavaScript からも読めます。

`GET /health` は `{ "status": "ok", "version": "1.8.0" }` のように、動いている版を返します。

### ランキング（`top-tracks.json`、静的モードのみ）

このデータはライブAPIモードのエンドポイントとしては提供されず、静的モードでのみ `top-tracks.json` および `.yaml` として出力されます。各楽曲オブジェクトには `rank` と `genres` が付与されます。LLMが設定されている場合は、ランキング全体の傾向を表す `mood`（例: `"最近は夜に似合う曲ばかり聴いているようです"`）も記録されます（未設定時は `mood: null`）。

`mood` は上位10曲の構成が大きく変化したときに限り再生成を行うキャッシュ制御を設けているため、`mood.generated_at`（ムード文生成日時）は `fetched_at`（データ取得日時）より過去の時刻を指す仕様となっています（詳細は[設計メモ](#ランキングのムード文を毎回作らない理由)を参照）。集計期間と件数は `generate` コマンドの `--range` および `--limit` オプションで指定します（[ランキングの集計期間](#ランキングの集計期間)）。

### 埋め込み用エンドポイント

| パス | 内容 | クエリパラメータ |
|---|---|---|
| `GET /embed` | iframe用HTML | `theme`（`dark` / `light` / `auto`。`auto` は閲覧者の OS の設定に合わせる） `transparent` `refresh`（秒、10〜3600、既定30） `max_width`（px、240〜1920、既定460。`full` で親の幅いっぱい） |
| `GET /badge.svg` | now-playingカード画像（背景は透過。ライトの背景に貼るときは `theme=light`） | `theme` |
| `GET /embed.js` | JavaScript埋め込みスクリプト | — |

`/badge.svg`・`/embed`・`/embed.js`・`/api/now-playing` は `Cross-Origin-Resource-Policy: cross-origin` を返すので、`Cross-Origin-Embedder-Policy: require-corp` を有効にしたサイトにも埋め込めます。`/embed.js` は `Cache-Control: public, max-age=300, must-revalidate` で配ります（修正は5分以内に届きます）。ジャケ写は Spotify の CDN（`*.scdn.co`・`*.spotifycdn.com`）からだけ読み込みます。

`/badge.svg` と `/embed` は失敗しても 200 でカードを返し、理由を `X-Spotify-Embedded-Error` ヘッダーで示します。

| 値 | 意味 |
|---|---|
| `spotify_unavailable` | Spotify から取得できなかった |
| `rate_limited` | レート制限を超えた |

---

## 静的モードとライブAPIを両方使う

ランキングは静的モード、now-playing はライブAPI、という構成にできます。同じ設定を2か所に登録します。

1. `npm run setup` で設定します（`gh` があれば GitHub Secrets にも登録されます）
2. Workers に `npm run deploy` し、Secrets を登録します（[Cloudflare Workers](#cloudflare-workers推奨無料)）
3. `npm run setup` で refresh_token を取り直したら、**GitHub Secrets と `wrangler secret` の両方**を更新します

---

## デプロイ（ライブAPIモードのみ）

データベースの用意は不要です。認証情報などの秘密情報はリポジトリに含めず、各ホスティングサービスのシークレット管理機能で設定します。本番運用時はセキュリティのため、`CORS_ORIGIN` を自身のWebサイトのオリジンに限定することを推奨します。

### Cloudflare Workers（推奨・無料）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Sh1n1230/SpotifyEmbedded)

Cloudflare Workersの無料プラン（1日最大10万リクエスト）の範囲内で運用できます。isolate の起動が数ミリ秒で済むため、しばらくアクセスが無くても、GitHub READMEに埋め込んだ画像が画像プロキシ（camo）の時間制限に間に合います。

```bash
npx wrangler login
npm run deploy
npx wrangler secret put SPOTIFY_CLIENT_ID        # プロンプトに従って各値を設定
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put SPOTIFY_REFRESH_TOKEN
npx wrangler secret put LLM_API_KEY              # 任意（LLM_BASE_URL / LLM_MODEL も同様）
```

ムード文の保存先（Workers KV のネームスペース）は事前に作る必要はありません。`wrangler.jsonc` の `MOODS` バインディングには `id` を書いておらず、初回の `npm run deploy` で Wrangler が自動作成して Worker にバインドします（[automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)）。対話的に実行した場合は、既存のネームスペースにつなぐか新しく作るかを聞かれることがあり、作成後は `id` が `wrangler.jsonc` に書き戻されます。書き戻された `id` は残しても消しても構いません。2回目以降のデプロイは、デプロイ済みの Worker の `MOODS` バインディングをそのまま引き継ぎます。

`npm run setup` を実行済みの場合は、`npx wrangler secret bulk .env` で一括登録できます。`.env` の中身がそのまま Secret になるので、先に中身を確かめてください。Workers で使うのは `SPOTIFY_CLIENT_ID`・`SPOTIFY_CLIENT_SECRET`・`SPOTIFY_REFRESH_TOKEN`・`LLM_API_KEY`・`LLM_BASE_URL`・`LLM_MODEL`・`CORS_ORIGIN` だけで、`PORT` や `AUTH_STORE_PATH` は意味を持ちません。

`CORS_ORIGIN` は秘密情報ではないので、`wrangler.jsonc` の `vars` か Cloudflare のダッシュボードの変数に書くと、値を確かめやすくなります（フォークにコミットしたくない場合は Secret でも動きます。[Environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)）。

デプロイ先URLは `https://spotify-embedded.<subdomain>.workers.dev` です。設定内容は [`wrangler.jsonc`](wrangler.jsonc) に記述されています。ローカル環境でWorkersとして動作確認を行うには、`.dev.vars.example` を `.dev.vars` にコピーして `npm run dev:worker` を実行します。

- 楽曲ごとのムード文はWorkers KVに永続化します。Workersの実行インスタンスはリクエスト終了後に破棄されやすいため、インメモリキャッシュのみでは同一楽曲に対するLLMの重複呼び出しを防げません。KV の無料枠の書き込みは1日1,000回で、超えると保存に失敗し、isolate が入れ替わるたびにムード文を作り直します（[KV の制限](https://developers.cloudflare.com/kv/platform/limits/)）。
- Workers環境ではファイルシステムが利用できないため、`data/auth.json` は読み込めません。設定値はすべてWranglerのシークレット機能で環境変数として設定します。
- 認証用エンドポイント（`npm run auth` / `/auth/*`）はローカル実行専用です。セキュリティ上、Workers環境では有効化しないでください。

> `CORS_ORIGIN` を設定しないまま（`*`）だと、どのサイトからでも API を呼べる旨の案内が Workers Logs に出ます。Workers の実行環境（isolate）は頻繁に作り直され、そのたびに1回出るので、警告ではなく情報（info）のレベルで出しています。埋め込み先のオリジンを `CORS_ORIGIN` に設定すると出なくなります。Secrets の入れ忘れも、最初のリクエストでログに出ます（`/api/now-playing` は 503 を返します）。

### Docker（Fly.io / Cloud Run / VPS）

```bash
docker build -t spotify-embedded .
docker run -p 3000:3000 --env-file .env spotify-embedded
```

`.env` は `npm run setup` が作ります（`.dockerignore` で除外しているので、イメージには入りません）。秘密情報を `-e KEY=値` でコマンドラインに書くと、シェルの履歴や `ps` に残るので避けてください。本番のプラットフォームでは、それぞれのシークレット機能（`fly secrets set` など）を使います。

`docker run --env-file` は dotenv と違って値の引用符を外さず、`export` も解釈しません。`npm run setup` は `#` や空白を含む値を引用符で囲んで `.env` に書くので、そのような値があるときは各ホストのシークレット機能か、引用符を外した `--env-file` 用のファイルを使ってください。

永続ボリュームを `/app/data` にマウントすることで、環境変数の代わりに `data/auth.json` による設定管理も可能です。本番のイメージでは `npm run setup` を実行できないので、ホストで `npm run setup` を実行して作った `data/auth.json` を置きます。コンテナは `USER node`（uid 1000）で動くので、refresh_token が更新されたときに書き戻せるよう `chown 1000:1000` で書き込みを許してください。

**待機中に止まるホストでは最小台数を設定してください。** Cloud Run は既定で0台まで、Fly.io は既定で使われていないマシンを止めるため、起動に数秒かかり、GitHub の camo が画像の取得を打ち切って README の画像が壊れます。Cloud Run は最小インスタンス数を1に、Fly.io は `auto_stop_machines = false`（または `min_machines_running = 1`）にします。

**リバースプロキシの裏では `TRUSTED_PROXY_HEADER` を設定してください。** 設定しないと全員がプロキシのアドレスになり、レート制限の枠（60秒100回）を共有します。Fly.io は `fly-client-ip`、Cloud Run は `x-forwarded-for` が例です。

---

## 設定

| 変数 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `SPOTIFY_CLIENT_ID` | ✓ | — | Spotifyアプリの Client ID |
| `SPOTIFY_CLIENT_SECRET` | ✓ | — | Spotifyアプリの Client Secret |
| `SPOTIFY_REFRESH_TOKEN` | ✓ | — | `npm run setup` が取得したリフレッシュトークン |
| `LLM_API_KEY` | | — | 未設定時はムード文なしで動作。`LLM_BASE_URL` がローカル（`localhost`・`127.0.0.1`・`[::1]`）のサーバーなら無くてもよい |
| `LLM_BASE_URL` | | API キーの名前で決まる（下記） | OpenAI互換のエンドポイント（末尾の `/chat/completions` は付けない。クエリは保つ）。API キーを平文で送らないよう `https://` に限る（`http://` は `localhost`・`127.0.0.1`・`[::1]` だけ使える。それ以外はムード文なしで動く）。URL に `user:pass@` を含めない |
| `LLM_MODEL` | | 送り先のプリセットの既定（Gemini は `gemini-3.1-flash-lite`、OpenAI は `gpt-4o-mini`） | 使用モデル。既定のモデルの無い送り先（Groq・OpenRouter・ローカルなど）では必須（無いとムード文なしで動き、起動時に案内する） |
| `LLM_MAX_TOKENS` | | `80` | ムード文の生成の出力の上限（16〜4096）。推論を止められないモデルで応答が空になるときに上げる |
| `LLM_TEMPERATURE` | | `0.7` | ムード文の生成の temperature（0〜2） |
| `NOW_PLAYING_CACHE_SECONDS` | | `30` | ライブAPIが再生状況をメモリに保持する秒数（5〜300）。この間は Spotify を呼ばない。曲の切り替わりを早く反映したければ短く、Spotify の利用枠を節約したければ長くする |
| `SPOTIFY_REDIRECT_URI` | | `http://127.0.0.1:<PORT>/auth/callback` | Dashboard の登録値と一致させる（`PORT` を変えると既定値も変わる。`npm run auth` が起動時に表示する） |
| `PORT` | | `3000` | サーバーの待受ポート（1〜65535 の整数。それ以外は起動時に案内して終了する） |
| `HOST` | | すべてのインターフェース（`npm run auth` では `127.0.0.1`） | Node版の待ち受けるホスト（例: `127.0.0.1` でループバックだけ）。Docker では未設定のままにする |
| `CORS_ORIGIN` | | `*` | 許可するオリジン。カンマ区切りで複数書ける（例: `https://a.example,https://b.example`）。スキームとホスト（とポート）だけを書く（末尾の `/` は取り除く。パス付きなどオリジンとして読めない値は使わずに警告する）。`*` はほかのオリジンと一緒には使えない（混ぜると `*` を無視する）。本番では埋め込み先サイトに限定を推奨 |
| `TRUSTED_PROXY_HEADER` | | — | Node版のレート制限でクライアントIPとして使うヘッダー（例: `fly-client-ip`・`x-forwarded-for`・`forwarded`。`forwarded`（RFC 7239）は最後の要素の `for=` を読む。値のポートは外す）。リバースプロキシ配下でのみ設定（ヘッダーは偽装できるため、プロキシが必ず上書きする構成に限る） |
| `AUTH_STORE_PATH` | | `data/auth.json` | 認証情報の保存先 |
| `NODE_ENV` | | — | `production` で本番相当として扱う（今は、`CORS_ORIGIN` が `*` のままなら起動時に警告することにだけ使う。Docker の既定は `production`） |
| `ENABLE_AUTH_ROUTES` | | `false` | `true`（または `1`・`yes`・`on`）で `/auth/*` を有効化（`npm run auth` が設定する。ローカル専用） |

認証情報（`SPOTIFY_*`・`LLM_API_KEY` など）の前後の空白と改行は取り除いて読みます（貼り付けで末尾に改行が付いても `invalid_client` になりません）。

設定値は **環境変数 → `data/auth.json`** の優先順位で解決されます。環境変数が優先されるため、`.env` ファイルのみで設定を行っている既存の構成にもそのまま適用されます。

`LLM_API_KEY` は `OPENAI_API_KEY`、`OPENROUTER_API_KEY`、`GROQ_API_KEY`、`GEMINI_API_KEY`、`GOOGLE_API_KEY` の各環境変数名にも対応しています（`LLM_API_KEY` があればそれが優先）。`LLM_BASE_URL` を設定しないときは、キーを読んだ名前で送り先を決めます。別のサービスのキーを既定の Gemini に送らないためです。

| キーの名前 | `LLM_BASE_URL` が無いときの送り先 |
|---|---|
| `LLM_API_KEY`・`GEMINI_API_KEY`・`GOOGLE_API_KEY`・`data/auth.json` | `https://generativelanguage.googleapis.com/v1beta/openai`（Gemini） |
| `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| `GROQ_API_KEY` | `https://api.groq.com/openai/v1` |

`GOOGLE_API_KEY` は Maps・YouTube など Gemini 以外の Google API でも使われる名前なので、これを LLM のキーとして読んだときは、起動時（Workers は最初のリクエスト、`generate` は実行の冒頭）にその旨をログに出します。別の目的のキーの場合は、`LLM_API_KEY` か `GEMINI_API_KEY` に Gemini のキーを設定してください。

`npm run setup` では Gemini・OpenAI・Groq・OpenRouter をプリセットから選べます（Groq と OpenRouter は提供するモデルの入れ替わりが早いので既定のモデルを持たず、モデル名を入力します）。

GitHub Actions（静的モード）のワークフローは `LLM_API_KEY`・`LLM_BASE_URL`・`LLM_MODEL` の名前の Secrets だけを渡すので、別名では登録しないでください（`npm run setup` の自動登録はこの名前を使います）。

同様に `LLM_BASE_URL` は `OPENAI_BASE_URL`、`LLM_MODEL` は `GROQ_MODEL` でも指定できます。OpenAI には、推論モデル（o 系・gpt-5 系）でも動くよう `max_tokens` ではなく `max_completion_tokens` を送り、`temperature` を受け付けないモデルでは外して送り直します。

Ollama などローカルの LLM を使う場合は、`LLM_BASE_URL=http://localhost:11434/v1` と `LLM_MODEL`（例: `llama3.2`）を設定します。API キーは要りません。

---

## 設計メモ

### audio-features を使わない理由

Spotify Web APIでは、2024年11月以降に作成された開発者アプリケーションに対して `/audio-features`（テンポやエネルギーなどの楽曲特徴量エンドポイント）の提供を終了しました。本プロジェクトではこれに代わり、アーティストのジャンル情報（`/artists`）、人気度（`popularity`）、および楽曲名・アーティスト名・アルバム名をLLMへ与えてムード文を推論する構成としています。

ただしAPIのアクセス制限は拡大しており、現在新規作成されたアプリケーションでは `genres` と `popularity` の取得も制限されています（`/artists?ids=` のバッチ取得は 403 Forbidden が返り、単体取得でも `genres` フィールドが除外されます）。さらに 2026年2月の Web API の変更で、Development Mode のアプリケーションからはバッチ取得の `GET /artists` そのものが削除されました（[Web API Changelog - February 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)）。extended quota mode が承認された一部のアプリケーションでは現在も返却されるため機能自体は維持していますが、実行プロセス内で一度「使えない」ことを示す応答（403、またはエンドポイントの削除を示す 404・410）を検知した場合は以降のリクエストを抑止し、不要なHTTP往復の発生を防いでいます（429・5xx・タイムアウトは一時的な失敗として、次の機会にまた試します）。

したがって多くの環境において、ムード推論の入力として実際に利用されるのは楽曲名・アーティスト名・アルバム名の3項目となります。取得できなかった項目はプロンプトから該当行を除外しています（「不明」などの欠損表現をプロンプトに含めると、生成されるムード文がその語彙に引きずられるためです）。

### ランキングのムード文を毎回作らない理由

ランキング情報は数週間から1年の長期間を集計対象とするため、データ取得ごとにLLMを呼び出すと、ほぼ同一の入力に対して無駄なAPIコストが発生します。一方で一般的なTTL（有効期間、例: 24時間）によるキャッシュ制御では、上位楽曲に変化がない場合でも期限切れに伴う無駄な再生成が走り、逆に短時間で上位楽曲が大きく変動した場合でも期限までは古いムード文が維持されてしまいます。いずれの問題も、キャッシュの失効判定を「時間経過」に依存していることに起因します。

そこで本ツールでは、ムード文のキャッシュ失効を「ランキングの構成楽曲」に連動させています。

- ムード文は、`--limit` や `--count` に関係なく、常に上位10曲から作ります（見出しに「トップ50」と出ていても、根拠は上位10曲です）。
- 生成時点の上位10曲のIDを、生成根拠としてムード文とともに記録します。
- 最新の上位10曲のうち、前回の生成根拠に含まれていなかった新規楽曲が3曲以上に達した段階で再生成を行います（同一楽曲内の順位変動はトリガーとしません）。
- 比較対象は「直前の取得データ」ではなく「現行ムード文を生成した時点の構成」です。1曲ずつの緩やかな変化であっても、変化が累積すれば確実に再生成が実行されます。
- この生成根拠は `snapshot.json` に保存し、GitHub Actions の実行をまたいで保持されます（判定ロジックは `src/core/rankingMood.ts`）。
- LLM呼び出しの失敗などによって再生成が行えなかった場合は既存のムード文を維持し、次回の更新サイクルで再試行します。
- ムード文を作らない回（`--no-mood`・LLM 未設定・上位曲が0件・ランキングの取得の失敗）でも、記録は消さずに残します。
- 顔ぶれに関係なく作り直したいときは `--refresh-ranking-mood`（Actions では Run workflow の `refresh_ranking_mood`）を使います。

### 似たプロジェクトとの違い

再生中の楽曲情報をSVGカード化する先行プロジェクトは複数存在します（[spotify-github-profile](https://github.com/kittinan/spotify-github-profile)、[vinilo](https://github.com/icortesb/vinilo) など）。本プロジェクトが持つ主な相違点は以下のとおりです。

- **日本語によるムード文の自動生成**：再生中の楽曲特徴やタイトルから推論したムード文を一言で提示し、楽曲名やアルバム名はムード文の根拠（出典）として配置します（先行ツールの多くは楽曲情報の単なる表示にとどまります）。
- **Webサイトへの埋め込みを主眼とした設計**：GitHub READMEへの画像埋め込みだけでなく、ポートフォリオサイト等への組み込みを前提に設計されています（Shadow DOMによるスタイル隔離、JavaScript埋め込みタグ、iframe、各種テーマ対応）。
- **データとしての再利用性**：表示用SVGの出力に加え、外部プログラムから利用可能なJSONおよびYAMLの公開スキーマを提供します。
- **動作モード間でのスキーマ統一**：サーバー不要の静的モードとリアルタイムなライブAPIモードで出力JSONのスキーマを統一しています。運用の初期段階では静的モードを採用し、後からライブAPIモードへ移行する場合でも、データ取得先URLを変更するだけで対応できます。

---

## ライセンス

[MIT](LICENSE)

## コントリビューション

開発手順と脆弱性の報告方法は [`CONTRIBUTING.md`](CONTRIBUTING.md) と
[`SECURITY.md`](SECURITY.md) を参照してください。リリースは
`vX.Y.Z` 形式のタグを起点にGitHub Actionsが自動作成します。版ごとの変更点と、
アップグレード時に必要な対応は [`CHANGELOG.md`](CHANGELOG.md) にあります。
