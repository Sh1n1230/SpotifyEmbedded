# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build commands

```bash
npm run dev        # development server with auto-restart (tsx watch)
npm run build      # compile TypeScript → dist/
npm start          # run compiled output
npm run auth       # start server with OAuth routes enabled (one-time Spotify setup)
npm run typecheck  # TypeScript type check without emitting
```

## Architecture

Backend API server (Node.js + TypeScript + Express).

- `src/types/index.ts` — canonical TypeScript interfaces; all modules import from here
- `src/config.ts` — env validation; fails fast on startup if required vars are missing
- `src/spotify/` — Spotify API client (native fetch), token auto-refresh, nowPlaying, topTracks
- `src/gemini/moodGenerator.ts` — Gemini 2.0 Flash generates Japanese mood strings from track metadata
- `src/cache/index.ts` — three node-cache instances: nowPlaying (30s TTL), topTracks (1h TTL), mood (per trackId, no TTL)
- `src/middleware/formatResponse.ts` — JSON/YAML content negotiation via `res.sendFormatted()`
- `src/routes/` — Express routers for /api/now-playing, /api/top-tracks, /api/status, /auth/*

## Key constraints

- Spotify `/audio-features` is deprecated for new apps (post Nov 2024) — do not use it
- Mood inference uses: artist genres (from `/artists` batch endpoint), track popularity, track/artist/album names
- Top tracks period is `short_term` only (~4 weeks)
- `module: "Node16"` in tsconfig — imports must use `.js` extensions even for `.ts` source files

## Environment variables

See `.env.example` for the full list. Required: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `GEMINI_API_KEY`.
