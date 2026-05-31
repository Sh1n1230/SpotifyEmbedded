# SpotifyEmbedded

Self-hosted API that exposes your Spotify listening activity for embedding in personal portfolio sites. Returns the currently playing track (with album art, artist, track name) alongside a Japanese AI-generated mood description, plus your recent top tracks.

## Features

- `GET /api/now-playing` — current track with **album art**, **artist name**, **track name**, and a **Gemini-generated Japanese mood** (e.g. "今ノリノリなようです")
- `GET /api/top-tracks` — ranked list of your top 50 tracks from the past ~4 weeks
- `GET /api/status` — all data in one call
- **JSON and YAML** response formats
- Auto-refreshing Spotify OAuth token
- In-memory caching (30s for now-playing, 1h for top-tracks)
- Rate limiting to protect upstream APIs

## Quick Start

### 1. Prerequisites

- Node.js 20+
- A [Spotify account](https://spotify.com)
- A [Google AI Studio](https://aistudio.google.com) account (free)

### 2. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/SpotifyEmbedded.git
cd SpotifyEmbedded
npm install
cp .env.example .env
```

### 3. Spotify app setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Under **Settings**, add `http://127.0.0.1:3000/auth/callback` as a Redirect URI.
3. Copy **Client ID** and **Client Secret** into `.env`.

### 4. Get your Spotify refresh_token (one-time)

```bash
npm run auth
```

Open [http://localhost:3000/auth/login](http://localhost:3000/auth/login) in your browser, log in with your Spotify account, and authorize the app. The page will display your `SPOTIFY_REFRESH_TOKEN` — copy it into `.env`.

Stop the server (`Ctrl+C`).

### 5. Get your Gemini API key (free)

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Create an API key and paste it into `.env` as `GEMINI_API_KEY`.

### 6. Run

```bash
npm run dev        # development (auto-restart on file changes)
npm run build && npm start  # production
```

## API Reference

All endpoints support JSON (default) and YAML (`?format=yaml` or `Accept: application/yaml`).

### `GET /api/now-playing`

Returns the currently playing track with a mood description.

**Response:**
```json
{
  "is_playing": true,
  "track": {
    "id": "4uLU6hMCjMI75M1A2tKUQC",
    "name": "Never Gonna Give You Up",
    "artist": "Rick Astley",
    "album": "Whenever You Need Somebody",
    "album_art_url": "https://i.scdn.co/image/...",
    "duration_ms": 213573,
    "popularity": 79,
    "spotify_url": "https://open.spotify.com/track/...",
    "preview_url": "https://p.scdn.co/mp3-preview/..."
  },
  "mood": {
    "text": "今ノリノリなようです",
    "generated_at": "2025-05-31T10:00:00.000Z"
  },
  "fetched_at": "2025-05-31T10:00:00.000Z"
}
```

When nothing is playing: `is_playing: false`, `track: null`, `mood: null`.

### `GET /api/top-tracks`

Returns your top 50 tracks from the past ~4 weeks.

```json
{
  "range": "short_term",
  "fetched_at": "2025-05-31T10:00:00.000Z",
  "tracks": [
    {
      "rank": 1,
      "id": "...",
      "name": "Song Name",
      "artist": "Artist Name",
      "album": "Album Name",
      "album_art_url": "https://i.scdn.co/image/...",
      "duration_ms": 200000,
      "popularity": 85,
      "genres": ["pop", "dance pop"],
      "spotify_url": "https://open.spotify.com/track/...",
      "preview_url": null
    }
  ]
}
```

### `GET /api/status`

Combined response with both now-playing and top-tracks.

### YAML format

```bash
curl "http://localhost:3000/api/now-playing?format=yaml"
# or
curl -H "Accept: application/yaml" http://localhost:3000/api/now-playing
```

## Embedding in your portfolio

```javascript
// Vanilla JS / React / Astro / etc.
const res = await fetch('https://your-api.example.com/api/now-playing');
const data = await res.json();

if (data.is_playing) {
  console.log(data.track.name);         // "Never Gonna Give You Up"
  console.log(data.track.artist);       // "Rick Astley"
  console.log(data.track.album_art_url); // album cover URL
  console.log(data.mood.text);          // "今ノリノリなようです"
}
```

## Deployment

This server is stateless (no database). Deploy anywhere Node.js runs:

- [Railway](https://railway.app) (free tier)
- [Render](https://render.com) (free tier)
- [Fly.io](https://fly.io)

Set the same environment variables as your `.env` in the platform's dashboard. Set `CORS_ORIGIN` to your portfolio domain.

## Why no audio features?

Spotify deprecated the `/audio-features` endpoint for apps created after November 2024. This project infers mood from **artist genres** (fetched from `/artists`), **track popularity**, and track/album metadata — passed to Gemini 2.0 Flash for Japanese mood generation.

## License

MIT
