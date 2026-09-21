# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build commands

```bash
npm run dev        # development server with auto-restart (tsx watch)
npm run build      # compile TypeScript → dist/
npm start          # run compiled output
npm run setup      # interactive OAuth setup (writes .env + data/auth.json, optionally gh secrets)
npm run generate   # generate static artifacts into ./out
npm run auth       # legacy: start server with OAuth routes enabled
npm run typecheck  # TypeScript type check without emitting
```

## Two delivery modes

The same core powers both. This split is the product's core idea — don't collapse it.

- **Static mode** (no server): `src/cli/generate.ts` → SVG / JSON / YAML / HTML, published by
  `.github/workflows/update-spotify.yml` to the `spotify-data` branch. Emitted JSON uses the
  *identical* schema as the live API so consumers can swap URLs.
- **Live API mode**: the Express server in `src/index.ts`.

## Architecture

- `src/types/index.ts` — canonical TypeScript interfaces; all modules import from here
- `src/authStore.ts` — credential resolution (env → `data/auth.json`) and persistence (0600)
- `src/config.ts` — **lazy getters**. Secrets must not be evaluated at import time, or `setup`
  breaks before it can write anything
- `src/core/collect.ts` — the only data-collection path; used by both routes and CLI
- `src/spotify/` — API client (native fetch), token auto-refresh, nowPlaying, topTracks, oauth,
  and `artists.ts` (the single genre-lookup path, shared by both fetchers)
- `src/llm/` — OpenAI-compatible chat client (`client.ts`), provider presets (`providers.ts`),
  and the Japanese mood prompt (`moodGenerator.ts`). Any OpenAI-format endpoint works;
  the presets are input helpers, not an integration list. No provider SDK.
  - **Reasoning must be disabled.** A thinking model spends the small `max_tokens` budget on
    reasoning and returns empty content with `finish_reason: length`. The parameter differs per
    vendor, and sending the wrong one is a 400, so `noReasoningParams()` in `client.ts`
    dispatches on the endpoint host: `reasoning: {effort}` for OpenRouter,
    `reasoning_effort` for Gemini. Add a branch rather than sending it to everyone.
  - Gemini's OpenAI-compatible base URL is `https://generativelanguage.googleapis.com/v1beta/openai`
    — not `/v1beta`, not `/v1beta/interactions`.
  - `client.ts` retries once on 5xx (Gemini's `gemini-3.x-flash` 503s under load; the
    `-lite` models are markedly more reliable).
- `src/render/` — pure data→string renderers (`card`, `ranking`, `page`, `text`, `theme`, `image`)
- `src/cli/` — `spotify-embedded setup | generate`
- `src/cache/index.ts` — node-cache instances: nowPlaying (30s), topTracks (1h), mood (24h, 200 keys),
  art (24h, 100 keys)
- `src/middleware/formatResponse.ts` — JSON/YAML content negotiation via `res.sendFormatted()`
- `src/routes/` — `/api/now-playing`, `/api/top-tracks`, `/api/status`, `/auth/*`, `/embed`,
  `/badge.svg`, `/ranking.svg`
- `public/embed.js` — one-tag embed; renders into a Shadow DOM so host CSS can't leak in

## Key constraints

- Spotify `/audio-features` is deprecated for new apps (post Nov 2024) — do not use it
- **The same restriction now covers more fields.** On a post-Nov-2024 app, `/artists?ids=`
  returns 403, single-artist responses omit `genres`, and `popularity` / `preview_url` are
  absent from both `/me/player/currently-playing` and `/me/top/tracks`. `src/spotify/artists.ts`
  keeps the genre lookup for extended-quota apps but latches "unavailable" after the first 403
  so it stops retrying. `TrackSummary.popularity` is `number | null`; the key always exists.
- Mood inference therefore usually has only track/artist/album names. `moodGenerator` drops
  absent signals from the prompt rather than writing "不明" — a stated-but-empty hint skews output.
- `spotifyFetch` throws `SpotifyApiError` on any non-2xx other than the handled 401/429/204.
  Callers must not assume a returned Response is `ok`.
- LLM is optional everywhere. `hasLlmConfigured()` gates it; never make it required to boot.
- Top tracks period is one of Spotify's three presets — `short_term` (~4 weeks, default),
  `medium_term` (~6 months), `long_term` (~1 year). Arbitrary month counts are not supported by
  the API. Fetch size is fixed to `10 | 30 | 50`. Both are parsed in `src/core/topTracksParams.ts`
  and keyed into the cache as `top-tracks:<range>:<limit>`
- `module: "Node16"` in tsconfig — imports must use `.js` extensions even for `.ts` source files
- **SVG rendering**: GitHub's camo proxy does not render external `<image href>` or `<foreignObject>`.
  Album art must be base64 data URIs (`src/render/image.ts`), and text must be wrapped manually
  (`src/render/text.ts`). Always run track/artist strings through `escapeXml`.
- **`X-Frame-Options`**: DENY everywhere except `/embed`, which exists to be iframed
- Static mode carries `snapshot.json` forward so a paused Spotify doesn't produce empty cards

## Environment variables

See README for the full table. Required: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
`SPOTIFY_REFRESH_TOKEN`. LLM settings are OPTIONAL — without them the app runs and simply omits
the mood sentence. Resolution order is env → `data/auth.json`, so existing
env-only deployments are unaffected.
