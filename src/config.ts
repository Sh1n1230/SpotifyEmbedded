import 'dotenv/config';

function require_env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional_env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  spotify: {
    clientId: require_env('SPOTIFY_CLIENT_ID'),
    clientSecret: require_env('SPOTIFY_CLIENT_SECRET'),
    refreshToken: require_env('SPOTIFY_REFRESH_TOKEN'),
    redirectUri: optional_env('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:3000/auth/callback'),
  },
  groq: {
    apiKey: require_env('GROQ_API_KEY'),
    model: optional_env('GROQ_MODEL', 'llama-3.3-70b-versatile'),
  },
  server: {
    port: parseInt(optional_env('PORT', '3000'), 10),
    corsOrigin: optional_env('CORS_ORIGIN', '*'),
    enableAuthRoutes: optional_env('ENABLE_AUTH_ROUTES', 'false') === 'true',
  },
} as const;
