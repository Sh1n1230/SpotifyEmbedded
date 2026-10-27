/** カード・ページの描画（テーマの色・フォント・URL の扱いなど）と、起動時の案内。方針は ./support.ts の冒頭を参照。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { THEMES, FONT_STACK } from '../render/theme.js';
import { renderEmbedPage, STATIC_PAGE_CSP } from '../render/page.js';
import { portInUseHelp } from '../http/portInUse.js';
import type { NowPlayingResponse } from '../types/index.js';
import { NOW_ISO, ART_640, aTopTrackEntry } from './support.js';

describe('カードの文字色は、どちらのテーマでも背景に対して WCAG AA（4.5:1）を満たす', () => {
  /** WCAG 2.2 の相対輝度とコントラスト比 */
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  }

  it.each(
    (['dark', 'light'] as const).flatMap((name) =>
      (['fg', 'sub', 'muted', 'accent'] as const).map((key) => [name, key] as const)
    )
  )('%s テーマの %s', (name, key) => {
    const theme = THEMES[name];
    expect(contrast(theme[key], theme.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('embed.js は theme.ts と同じ色を使う（色を二重に持っているので、変え忘れを防ぐ）', () => {
    const source = readFileSync(new URL('../../public/embed.js', import.meta.url), 'utf8');
    const literal = /var THEMES = (\{[\s\S]*?\n {2}\});/.exec(source)![1];
    const embedThemes = runInNewContext(`(${literal})`) as Record<string, Record<string, string>>;

    for (const name of ['dark', 'light'] as const) {
      for (const [key, value] of Object.entries(embedThemes[name]!)) {
        expect(value, `${name}.${key}`).toBe(THEMES[name][key as keyof (typeof THEMES)[typeof name]]);
      }
    }
  });

  it('embed.js は theme.ts と同じフォント指定を使う（フォントも二重に持っているので、変え忘れを防ぐ）', () => {
    const source = readFileSync(new URL('../../public/embed.js', import.meta.url), 'utf8');
    const embedFont = /var FONT_STACK = "([^"]+)";/.exec(source)?.[1];

    expect(embedFont).toBe(FONT_STACK);
    expect(source).toContain("'  font-family: ' + FONT_STACK + ';'");
  });
});

describe('iframe 用ページ（/embed・静的モードの index.html）のサーバー側の描画', () => {
  function aNowPlaying(overrides: Partial<NonNullable<NowPlayingResponse['track']>> = {}): NowPlayingResponse {
    return {
      is_playing: true,
      track: {
        id: 'track-1',
        name: 'Midnight Drive',
        artist: 'Neon District',
        album: 'After Hours',
        album_art_url: ART_640,
        duration_ms: 213_000,
        popularity: null,
        spotify_url: 'https://open.spotify.com/track/track-1',
        preview_url: null,
        ...overrides,
      },
      mood: null,
      fetched_at: NOW_ISO,
    };
  }

  it('https でない URL はリンク・画像に使わない（エスケープだけでは javascript: を防げない）', () => {
    const html = renderEmbedPage({
      nowPlaying: aNowPlaying({ spotify_url: 'javascript:alert(1)', album_art_url: 'data:image/svg+xml,x' }),
      topTracks: {
        range: 'short_term',
        limit: 10,
        fetched_at: NOW_ISO,
        mood: null,
        tracks: [aTopTrackEntry({ spotify_url: 'javascript:alert(2)', album_art_url: 'javascript:alert(3)' })],
      },
      state: 'playing',
    });

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:image/svg+xml');
    expect(html).toContain('<div class="card" id="card"');
    expect(html).toContain('no art');
  });

  it('ランキングでジャケ写の無い曲は、src の空の <img> ではなく同じ大きさの枠を置く', () => {
    const html = renderEmbedPage({
      nowPlaying: { is_playing: false, track: null, mood: null, fetched_at: NOW_ISO },
      topTracks: {
        range: 'short_term',
        limit: 10,
        fetched_at: NOW_ISO,
        mood: null,
        tracks: [aTopTrackEntry({ album_art_url: '' }), aTopTrackEntry({ rank: 2, id: 'track-2' })],
      },
      state: 'idle',
    });

    expect(html).not.toContain('src=""');
    expect(html).toContain('<span class="rank-art-placeholder" aria-hidden="true"></span>');
    expect(html).toMatch(/\.ranking img, \.rank-art-placeholder \{[^}]*width: 40px; height: 40px;/);
    // ジャケ写のある曲は今までどおり 64px 版
    expect(html).toContain('ab67616d00004851');
  });

  it('静的モード（liveEndpoint なし）にはスクリプトを全面禁止する meta CSP を入れる', () => {
    const html = renderEmbedPage({ nowPlaying: aNowPlaying(), state: 'playing' });

    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${STATIC_PAGE_CSP}">`);
    expect(STATIC_PAGE_CSP).toContain("default-src 'none'");
    expect(STATIC_PAGE_CSP).not.toContain('script-src');
    expect(html).not.toContain('<script');
  });

  it('ライブAPIの /embed（liveEndpoint あり）には meta CSP を入れない（ヘッダーの nonce つき CSP と積にならないように）', () => {
    const html = renderEmbedPage({ nowPlaying: aNowPlaying(), state: 'playing', liveEndpoint: '/api/now-playing' });

    expect(html).not.toContain('http-equiv="Content-Security-Policy"');
  });
});

describe('npm run dev のポート衝突の案内は、そのプラットフォームで使えるコマンドを出す', () => {
  it('Windows では cmd と PowerShell の書き方、netstat を出す（PORT=… や lsof は出さない）', () => {
    const text = portInUseHelp(3000, 'win32').join('\n');

    expect(text).toContain('set PORT=3001 && npm run dev');
    expect(text).toContain('$env:PORT=3001; npm run dev');
    expect(text).toContain('netstat -ano | findstr :3000');
    expect(text).not.toContain('lsof');
    expect(text).not.toMatch(/(^|\s)PORT=3001 npm run dev/);
  });

  it.each(['darwin', 'linux'] as const)('%s では従来どおり PORT=… と lsof を出す', (platform) => {
    expect(portInUseHelp(3000, platform)).toEqual([
      '✗ ポート 3000 はすでに別のプロセスが使用しています。',
      '   別のポートで起動する:  PORT=3001 npm run dev',
      '   使用中のプロセスを調べる:  lsof -nP -iTCP:3000 -sTCP:LISTEN',
    ]);
  });
});
