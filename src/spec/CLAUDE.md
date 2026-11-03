# src/spec

`*.test.ts` is the executable spec, one file per area: `describe` headings read
as requirements. Shared fetch mock, fixtures and the common `beforeEach` live in `support.ts`
(importing it registers the hooks). Mock at the
`fetch` layer, never by replacing modules — which URL, query and headers we hit is part of
what's being verified. Fixtures default to a post-Nov-2024 app (restricted fields absent).

- The Spotify access token, the in-flight refresh and the `/artists` 403 latch are module-level
  state; `beforeEach` resets them (`resetAccessToken`, `resetArtistGenreAvailability`), so every
  test starts without a token.
- CLI specs spawn `src/cli/index.ts` through `node_modules/tsx/dist/loader.mjs` in an empty temp
  dir with only `PATH`, so a developer's local config never leaks in.
