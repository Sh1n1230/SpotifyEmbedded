# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build commands

Run the same checks as CI, in order: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
(see CONTRIBUTING.md). `dev:worker` reads secrets from `.dev.vars`; `setup` is interactive OAuth (writes `.env` +
`data/auth.json`, optionally gh secrets); `auth` is legacy.

## Two delivery modes

The same core powers both. This split is the product's core idea — don't collapse it.

- **Static mode** (no server): `src/cli/generate.ts` → SVG / JSON / YAML / HTML, published by
  `.github/workflows/update-spotify.yml` to the `spotify-data` branch. `now-playing.json` uses
  the *identical* schema as the live API so consumers can swap URLs.
  `last-played.json` / `.yaml` (`{ track, mood, played_at }`, static-only) mirror the card's
  track from `snapshot.json`, so the JSON consumers get "last played" without changing that schema.
- **Live API mode is now-playing only** (`/api/now-playing`, `/badge.svg`, `/embed`, `embed.js`).
  Rankings are static-only by design: they aggregate weeks-to-a-year, so they don't need
  per-second freshness. Don't add ranking routes to the live API.
- **Live API mode**: the Hono app in `src/app.ts`, run by two entries — `src/index.ts` (Node:
  `npm run dev`, Docker) and `src/worker.ts` (Cloudflare Workers, the recommended host; config in
  `wrangler.jsonc`, `npm run deploy`). Runtime differences (static files, rate limiter, KV) are
  injected by the entry; routes must stay runtime-neutral. Workers replaced Render because a
  sleeping free instance cold-starts slower than GitHub camo's timeout, so `badge.svg` broke in
  READMEs. Don't recommend a host that sleeps.

## Architecture

- `src/config.ts` — **lazy getters**. Secrets must not be evaluated at import time, or `setup`
  breaks before it can write anything
- `src/core/collect.ts` — the only data-collection path; used by both routes and CLI
- `src/spotify/` — API client (native fetch), token auto-refresh (concurrent callers share one
  refresh; a rotated refresh_token is used in-process and written back only to `data/auth.json`),
  nowPlaying, topTracks, recentlyPlayed, oauth, `track.ts` (the single raw→`TrackSummary`
  mapping) and `artists.ts` (the single genre-lookup path; latches off on 403 or a response
  without genres, never on transient failures)
- `src/llm/` — OpenAI-compatible chat client (`client.ts`), provider presets (`providers.ts`),
  and the Japanese mood prompt (`moodGenerator.ts`). Any OpenAI-format endpoint works;
  the presets are input helpers, not an integration list. No provider SDK.
- `src/core/rankingMood.ts` — ranking-wide mood. **Invalidated by content, not time**: the
  record stores the top-10 track IDs it was generated from, and is regenerated only when ≥3 of
  the current top 10 are absent from that basis (order ignored). Don't replace this with a TTL.
  Only static mode uses it: `generate` carries the record in `snapshot.json` as `ranking_mood`.
  On LLM failure the previous record is kept, basis unchanged.
- `src/cache/index.ts` — in-memory `TtlCache` instances for the live API: nowPlaying (30s; `NOW_PLAYING_CACHE_SECONDS`), mood
  (24h, 200 keys; keyed by prompt version + model + track ID), art (24h, 20 keys). Not node-cache: it starts a timer at construction, which
  Workers forbids in global scope. Also an optional `DurableStore` (Workers KV binding `MOODS`)
  that `collect.ts` reads/writes through for per-track moods, because Workers isolates drop
  memory often (KV free tier: 1,000 writes/day).
- `public/embed.js` — one-tag embed; renders into a Shadow DOM so host CSS can't leak in. It is served as-is (no build),
  so it duplicates the fixed strings (`src/render/strings.ts`), the equalizer bars (`EQ_BARS` in `card.ts`) and the
  stale threshold; `browser.test.ts` checks they match
- `src/runtime.ts` — runtime differences the layers below the routes need. On Workers the entry turns off sharing of
  in-flight promises (now-playing fetch, token refresh, mood generation) across requests; only cached values are shared
- `src/http/background.ts` — the live API waits at most 5s for a mood (`LIVE_MOOD_DEADLINE_MS`), then answers
  `mood: null` and lets generation finish (`ctx.waitUntil` on Workers). The CLI waits to the end
- `src/version.ts` — `VERSION`, bumped together with `package.json` at release (a spec checks they match)

## Key constraints

- Spotify `/audio-features` is deprecated for new apps (post Nov 2024) — do not use it
- **The same restriction covers more than audio features.** On a post-Nov-2024 app, `/artists?ids=`
  returns 403, single-artist responses omit `genres`, and `popularity` / `preview_url` are
  absent from both `/me/player/currently-playing` and `/me/top/tracks`. `src/spotify/artists.ts`
  keeps the genre lookup for extended-quota apps but latches "unavailable" after the first 403, 404 or 410
  (the Feb 2026 change removed batch `GET /artists` from Development Mode apps; which status it returns is unverified)
  or a response with no genres, so it stops retrying. `TrackSummary.popularity` is `number | null`; the key always exists.
- Mood inference therefore usually has only track/artist/album names. `moodGenerator` drops
  absent signals from the prompt rather than writing "不明" — a stated-but-empty hint skews output.
- `spotifyFetch` throws `SpotifyApiError` on any non-2xx other than the handled 401/429/204.
  Callers must not assume a returned Response is `ok`. After a 429 it does not call Spotify again until `Retry-After`
  has passed; after `invalid_grant` / `invalid_client` the token refresh is not retried until the credentials change.
- Live API errors are `{ error, code }` (`src/http/respond.ts`). Spotify's rate limit is a 503, not a 429 — 429 is
  reserved for this API's own limiter. Missing required config is a 503 (`MissingConfigError`), never a 500.
- LLM is optional everywhere. `hasLlmConfigured()` gates it; never make it required to boot.
- Top tracks period is one of Spotify's three presets — `short_term` (~4 weeks, default),
  `medium_term` (~6 months), `long_term` (~1 year). Arbitrary month counts are not supported by
  the API. Fetch size is fixed to `10 | 30 | 50`. Both are validated in `src/core/topTracksParams.ts`
  (the CLI rejects anything else)
- `module: "Node16"` in tsconfig — imports must use `.js` extensions even for `.ts` source files
- **SVG rendering**: GitHub's camo proxy does not render external `<image href>` or `<foreignObject>`.
  Album art must be base64 data URIs (`src/render/image.ts`), and text must be wrapped manually
  (`src/render/text.ts`). Always run track/artist strings through `escapeXml`.
- **`X-Frame-Options`**: DENY everywhere except `/embed`, which exists to be iframed. On Workers,
  `public/` is served by Static Assets before the Worker runs, so its headers live in
  `public/_headers`
- **Workers**: secrets reach `process.env` via `nodejs_compat`, so `config.ts` works unchanged;
  `data/auth.json` is unavailable there. Import `dotenv` only in the Node entries
  (`src/index.ts`, `src/cli/index.ts`; `src/authServer.ts` reaches it through `src/index.ts`)
- `generate` keeps going when only the ranking fetch fails (ranking files stay as they were), and keeps the
  `ranking_mood` record in `snapshot.json` on runs that don't produce one (`--no-mood`, no LLM, zero tracks).
  `snapshot.json` is internal state (`schema_version`); it is not deployed to Pages.
- Static mode carries `snapshot.json` forward so a paused Spotify doesn't produce empty cards.
  When paused, `generate` first asks `/me/player/recently-played` (`src/spotify/recentlyPlayed.ts`)
  and uses it if `played_at` is newer than the snapshot — Actions runs hours apart, so
  currently-playing alone rarely catches playback. The scope `user-read-recently-played` was added
  in v1.3.0; older refresh tokens lack it, so any failure there degrades to the old carry-forward,
  never an error. Static-only: don't add it to the live API.

## Environment variables

See README for the full table. Required: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
`SPOTIFY_REFRESH_TOKEN`. LLM settings are OPTIONAL — without them the app runs and simply omits
the mood sentence. Resolution order is env → `data/auth.json`, so existing
env-only deployments are unaffected.
