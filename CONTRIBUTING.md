# Contributing

Thank you for contributing to SpotifyEmbedded.

## Development

```bash
npm ci
npm run typecheck
npm run build
```

Use `npm run setup` only with your local Spotify credentials. Never commit `.env`,
`data/auth.json`, refresh tokens, API keys, or generated private snapshots.

## Pull requests

Keep changes focused, describe the user-visible behavior, and include the
validation commands you ran. Pull requests must pass the CI and security
workflows before merging.

## Releases

Releases are created from semantic-version tags. After updating `version` in
`package.json` and `package-lock.json`, push a tag such as `v1.0.1`:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The release workflow type-checks and builds the project, attaches the npm
package archive, and generates GitHub release notes.
