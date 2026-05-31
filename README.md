# SpotifyEmbedded

自分のSpotifyの再生状況をポートフォリオサイトに埋め込むためのセルフホスト型APIサーバーです。現在再生中の曲（ジャケ写・アーティスト名・曲名）と、AIが生成した日本語のムード文、直近の再生ランキングを返します。

## 機能

- `GET /api/now-playing` — 現在再生中の曲（**ジャケ写・アーティスト名・曲名**）＋ **AI生成の日本語ムード文**（例: "今ノリノリなようです"）
- `GET /api/top-tracks` — 直近約4週間の再生ランキング（最大50曲）
- `GET /api/status` — 上記をまとめて一括取得
- **JSON / YAML** 両フォーマット対応
- Spotifyトークン自動更新
- インメモリキャッシュ（now-playing: 30秒、top-tracks: 1時間）
- レート制限でAPI保護

## セットアップ

### 必要なもの

- Node.js 20以上
- [Spotifyアカウント](https://spotify.com)
- [Groq](https://console.groq.com) のAPIキー（無料・クレジットカード不要）

### 1. クローン＆インストール

```bash
git clone https://github.com/Sh1n1230/SpotifyEmbedded.git
cd SpotifyEmbedded
npm install
cp .env.example .env
```

### 2. Spotifyアプリの作成

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリを作成
2. **Settings** → **Redirect URIs** に `http://127.0.0.1:3000/auth/callback` を追加
3. **Client ID** と **Client Secret** を `.env` に記入

### 3. Spotify refresh_token の取得（初回のみ）

```bash
npm run auth
```

ブラウザで `http://127.0.0.1:3000/auth/login` を開き、Spotifyアカウントでログイン・承認すると `SPOTIFY_REFRESH_TOKEN` が表示されます。それを `.env` にコピーし、サーバーを停止（`Ctrl+C`）してください。

### 4. Groq APIキーの取得（無料）

1. [Groq Console](https://console.groq.com) でAPIキーを発行
2. `GROQ_API_KEY` に記入

### 5. 起動

```bash
npm run dev        # 開発サーバー（ファイル変更で自動再起動）
npm run build && npm start  # 本番起動
```

## APIリファレンス

全エンドポイントはJSON（デフォルト）とYAML（`?format=yaml` または `Accept: application/yaml`）に対応しています。

### `GET /api/now-playing`

現在再生中の曲とムード文を返します。

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
    "text": "ダークな気分になっています",
    "generated_at": "2026-05-31T13:35:14.667Z"
  },
  "fetched_at": "2026-05-31T13:35:14.669Z"
}
```

再生していない場合: `is_playing: false`、`track: null`、`mood: null`

### `GET /api/top-tracks`

直近約4週間の再生ランキング（最大50曲）を返します。

```json
{
  "range": "short_term",
  "fetched_at": "2026-05-31T10:00:00.000Z",
  "tracks": [
    {
      "rank": 1,
      "id": "...",
      "name": "曲名",
      "artist": "アーティスト名",
      "album": "アルバム名",
      "album_art_url": "https://i.scdn.co/image/...",
      "duration_ms": 200000,
      "popularity": 85,
      "genres": ["hip hop", "rap"],
      "spotify_url": "https://open.spotify.com/track/...",
      "preview_url": null
    }
  ]
}
```

### `GET /api/status`

now-playing と top-tracks をまとめて返します。

### YAMLフォーマット

```bash
curl "http://localhost:3000/api/now-playing?format=yaml"
# または
curl -H "Accept: application/yaml" http://localhost:3000/api/now-playing
```

## ポートフォリオへの埋め込み方法

```javascript
// Vanilla JS / React / Astro など
const res = await fetch('https://your-api.example.com/api/now-playing');
const data = await res.json();

if (data.is_playing) {
  console.log(data.track.name);          // "Armed And Dangerous"
  console.log(data.track.artist);        // "Juice WRLD"
  console.log(data.track.album_art_url); // ジャケ写のURL
  console.log(data.mood.text);           // "ダークな気分になっています"
}
```

## デプロイ

DBは不要で、どこでも動かせます:

- [Railway](https://railway.app)（無料プランあり）
- [Render](https://render.com)（無料プランあり）
- [Fly.io](https://fly.io)

各プラットフォームのダッシュボードで `.env` と同じ環境変数を設定してください。本番環境では `CORS_ORIGIN` を自分のポートフォリオのURLに制限することを推奨します。

## audio-featuresを使わない理由

Spotifyは2024年11月以降に作成されたアプリでは `/audio-features`（テンポ・エネルギー等の音声特徴）エンドポイントを廃止しました。本プロジェクトでは代わりに **アーティストのジャンルタグ**（`/artists` から取得）・**楽曲の人気度**・**曲名・アーティスト名**をGroq（Llama 3.3）に渡してムードを推論しています。

## ライセンス

MIT
