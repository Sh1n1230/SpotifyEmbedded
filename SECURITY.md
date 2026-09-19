# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability. Use GitHub's
private vulnerability reporting for this repository when available. Otherwise,
contact the repository owner privately through GitHub.

## Protecting credentials

Spotify client secrets, refresh tokens, LLM API keys, and GitHub Actions
secrets must never be committed. Run `npm run setup` locally and store
production values in the deployment platform's secret manager.
