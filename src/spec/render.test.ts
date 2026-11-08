/** カード・ページの描画（テーマの色・フォント・URL の扱いなど）と、起動時の案内。方針は ./support.ts の冒頭を参照。 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { THEMES, FONT_STACK, formatDateJa, formatDateTimeJa } from '../render/theme.js';
import { renderNowPlayingCard } from '../render/card.js';
import { renderEmbedPage, STATIC_PAGE_CSP } from '../render/page.js';
import { renderRankingCard } from '../render/ranking.js';
import { portInUseHelp } from '../http/portInUse.js';
import { truncateToWidth, visualWidth, wrapToWidth, jsonForScript } from '../render/text.js';
import { albumArtAtSize, fetchImageDataUri, SIZE_PREFIX } from '../render/image.js';
import type { NowPlayingResponse } from '../types/index.js';
import { NOW_ISO, ART_640, aTopTrackEntry, calls, callsTo, respondWith, expectValidXml } from './support.js';

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

  it('デモ画面（public/index.html）も theme.ts と同じフォント指定を使う', () => {
    const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

    expect(/body \{[^}]*font-family: ([^;]+);/.exec(html)?.[1]).toBe(FONT_STACK);
  });

  it('デモ画面（public/index.html）の文字色は、どれも背景に対して 4.5:1 以上', () => {
    const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
    const rules = Array.from(html.matchAll(/([#\w-]+)\s*\{([^}]*)\}/g), ([, selector, body]) => ({ selector, body: body ?? '' }));
    const pageBackground = /background: (#[0-9a-f]{3,6})/.exec(rules.find((rule) => rule.selector === 'body')!.body)![1]!;
    const expand = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);

    const checked = rules.filter((rule) => /(^|[^-])color: #/.test(rule.body));
    expect(checked.length).toBeGreaterThan(3);
    for (const rule of checked) {
      const color = /(?:^|[^-])color: (#[0-9a-f]{3,6})/.exec(rule.body)![1]!;
      const background = /background: (#[0-9a-f]{3,6})/.exec(rule.body)?.[1] ?? pageBackground;
      expect(contrast(expand(color), expand(background)), rule.selector).toBeGreaterThanOrEqual(4.5);
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

    expect(text).toContain('set "PORT=3001" && npm run dev');
    expect(text).toContain('$env:PORT=3001; npm run dev');
    expect(text).toContain('netstat -ano | findstr :3000');
    expect(text).not.toContain('lsof');
    expect(text).not.toMatch(/(^|\s)PORT=3001 npm run dev/);
  });

  it('使用中のポートが 3001 なら、別のポート（3002）を例に出す', () => {
    expect(portInUseHelp(3001, 'linux').join('\n')).toContain('PORT=3002 npm run dev');
  });

  it('npm run auth で起動したときは npm run auth を例に出し、Redirect URI も変えるよう案内する', () => {
    const text = portInUseHelp(3000, 'linux', 'auth').join('\n');

    expect(text).toContain('PORT=3001 npm run auth');
    expect(text).toContain('SPOTIFY_REDIRECT_URI');
  });

  it.each(['darwin', 'linux'] as const)('%s では従来どおり PORT=… と lsof を出す', (platform) => {
    expect(portInUseHelp(3000, platform)).toEqual([
      '✗ ポート 3000 はすでに別のプロセスが使用しています。',
      '   別のポートで起動する:  PORT=3001 npm run dev',
      '   使用中のプロセスを調べる:  lsof -nP -iTCP:3000 -sTCP:LISTEN',
    ]);
  });
});

describe('SVG の文字幅の見積もりと折り返し（<text> は自動で折り返さない）', () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const clusters = (text: string) => Array.from(segmenter.segment(text), (s) => s.segment);

  // 家族（ZWJ シーケンス）・国旗（地域指示子2つ）・肌の色の修飾子・結合文字
  const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  const FLAG_JP = '\u{1F1EF}\u{1F1F5}';
  const THUMBS_UP_DARK = '\u{1F44D}\u{1F3FF}';
  const E_ACUTE = 'é';

  it.each([
    ['家族の絵文字（ZWJ シーケンス）', FAMILY, 1],
    ['国旗', FLAG_JP, 1],
    ['肌の色つきの絵文字', THUMBS_UP_DARK, 1],
    ['CJK 統合漢字拡張 B の 𠮷', '\u{20BB7}', 1],
    ['Symbols and Pictographs Extended-A の 🫠', '\u{1FAE0}', 1],
    ['既定で絵文字表示の ⚡', '⚡', 1],
    ['キーキャップの 1️⃣', '1️⃣', 1],
    // 半角は字の形でおおまかに分ける（Helvetica・Arial の字送りを大きめに丸めた値）
    ['結合文字つきの é', E_ACUTE, 0.55],
    ['ASCII の #', '#', 0.55],
    ['ASCII の数字', '7', 0.55],
    ['細い i', 'i', 0.3],
    ['大文字の A', 'A', 0.7],
    ['大文字の W', 'W', 0.85],
    ['かな', 'あ', 1],
    ['全角英数', 'Ａ', 1],
  ])('%s の幅は %s em', (_, text, width) => {
    expect(visualWidth(text)).toBe(width);
  });

  it.each([
    ['家族', `ab${FAMILY}${FAMILY}cd`],
    ['国旗', `ab${FLAG_JP}${FLAG_JP}cd`],
    ['肌の色', `ab${THUMBS_UP_DARK}${THUMBS_UP_DARK}cd`],
    ['結合文字', `${E_ACUTE.repeat(8)}`],
  ])('省略・折り返しは %s の途中で切らない', (_, text) => {
    const original = clusters(text);
    for (const width of [1, 1.5, 2, 2.5, 3]) {
      const truncated = truncateToWidth(text, width).replace(/…$/, '');
      expect(original.slice(0, clusters(truncated).length)).toEqual(clusters(truncated));

      const wrapped = wrapToWidth(text, width, 10);
      expect(wrapped.flatMap(clusters)).toEqual(original);
    }
  });

  it('空白を含まない長い半角の語も、各行が枠に収まるよう文字単位で割る', () => {
    const title = 'Supercalifragilisticexpialidocious_extended_remix_version_2024';

    for (const [width, lines] of [[10, 2], [10, 10], [6.5, 3]] as const) {
      const wrapped = wrapToWidth(title, width, lines);
      for (const line of wrapped) expect(visualWidth(line)).toBeLessThanOrEqual(width);
    }
    expect(wrapToWidth(title, 10, 10).join('')).toBe(title);
  });

  it('空白で区切れる英文は、今までどおり単語の途中で折らない', () => {
    expect(wrapToWidth('Midnight Drive Extended Mix', 5, 4)).toEqual(['Midnight', 'Drive', 'Extended', 'Mix']);
  });

  it('日本語は1文字単位で折る（今までどおり）', () => {
    expect(wrapToWidth('センチメンタルな夜を過ごしているようです', 10, 2)).toEqual([
      'センチメンタルな夜を',
      '過ごしているようです',
    ]);
  });
});

describe('now-playing カードの再生中インジケータは、OS の「視差効果を減らす」に従う', () => {
  const playing = () =>
    renderNowPlayingCard({
      state: 'playing',
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
      },
      mood: null,
    });

  it('SMIL（<animate>）ではなく CSS アニメーションで動かし、prefers-reduced-motion: reduce で止める', () => {
    const svg = playing();

    expectValidXml(svg);
    expect(svg).not.toContain('<animate');
    expect(svg).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.spotify-embedded-eq rect \{ animation: none;/);
    // 3本のバーがそれぞれの周期で動く（/embed の .eq span と同じ 0.9s / 1.25s / 0.75s）
    for (const dur of ['0.9s', '1.25s', '0.75s']) expect(svg).toContain(`${dur} ease-in-out infinite`);
    expect(svg.match(/<rect class="spotify-embedded-eq-\d"/g)).toHaveLength(3);
  });

  it('他の SVG と同じ文書に入っても衝突しないよう、クラス名と keyframes 名はカード固有にする', () => {
    const svg = playing();
    const style = /<style>([\s\S]*?)<\/style>/.exec(svg)![1]!;
    const selectors = style.match(/(^|\s)\.[\w-]+/g)!.map((s) => s.trim());
    const keyframes = style.match(/@keyframes [\w-]+/g)!;

    expect(selectors.every((s) => s.startsWith('.spotify-embedded-eq'))).toBe(true);
    expect(keyframes.every((k) => k.startsWith('@keyframes spotify-embedded-eq'))).toBe(true);
  });

  it('再生中でなければインジケータを描かない', () => {
    expect(renderNowPlayingCard({ state: 'idle', track: null, mood: null })).not.toContain('<style>');
  });
});

describe('SVG に焼き込む画像は Spotify の CDN の画像だけ（README に貼られる SVG の安全上の境界）', () => {
  function givenImage(status: number, contentType: string): void {
    respondWith((url) =>
      url.includes('.scdn.co') ? new Response('img', { status, headers: { 'content-type': contentType } }) : null
    );
  }

  it('https の i.scdn.co の小さい jpeg は data URI になる', async () => {
    await expect(fetchImageDataUri(ART_640)).resolves.toBe(
      `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`
    );
    expect(callsTo('.scdn.co')[0]?.init?.redirect).toBe('manual');
  });

  it.each([
    ['http の Spotify の CDN', 'http://i.scdn.co/image/abc'],
    ['別のホスト', 'https://example.com/a.jpg'],
    ['紛らわしいホスト', 'https://scdn.co.example.com/a.jpg'],
    ['サブドメインでない scdn.co', 'https://scdn.co/a.jpg'],
    ['data URI', 'data:image/png;base64,AAAA'],
    ['URL として読めない値', 'not a url'],
  ])('%s は取得しない（fetch も呼ばない）', async (_, url) => {
    await expect(fetchImageDataUri(url)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream', ''])(
    'content-type が %j なら埋め込まない（SVG の中に別の SVG を埋め込まない）',
    async (type) => {
      givenImage(200, type);

      await expect(fetchImageDataUri(ART_640)).resolves.toBeNull();
    }
  );

  it.each([404, 500])('%d なら null', async (status) => {
    givenImage(status, 'image/jpeg');

    await expect(fetchImageDataUri(ART_640)).resolves.toBeNull();
  });

  it('Content-Length が上限（512KB）を超えていれば、本文を読まずに断る', async () => {
    const cancel = vi.fn(() => Promise.resolve());
    respondWith((url) => {
      if (!url.includes('.scdn.co')) return null;
      const res = new Response('small', {
        headers: { 'content-type': 'image/jpeg', 'content-length': String(10 * 1024 * 1024) },
      });
      Object.defineProperty(res.body, 'cancel', { value: cancel });
      return res;
    });

    await expect(fetchImageDataUri(ART_640)).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('Content-Length が無くても、読みながら上限を超えた時点で打ち切る', async () => {
    let pulled = 0;
    respondWith((url) => {
      if (!url.includes('.scdn.co')) return null;
      // 64KB ずつ、いくらでも返す本文
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(64 * 1024));
        },
      });
      return new Response(body, { headers: { 'content-type': 'image/jpeg' } });
    });

    await expect(fetchImageDataUri(ART_640)).resolves.toBeNull();
    expect(pulled).toBeLessThan(20);
  });

  it('許可しないホストへのリダイレクトは辿らない', async () => {
    respondWith((url) =>
      url.includes('.scdn.co')
        ? new Response(null, { status: 302, headers: { location: 'https://evil.example/a.jpg' } })
        : null
    );

    await expect(fetchImageDataUri(ART_640)).resolves.toBeNull();
    expect(callsTo('evil.example')).toHaveLength(0);
  });

  it('Spotify の CDN の中でのリダイレクトは辿る', async () => {
    const moved = 'https://mosaic.scdn.co/640/abc';
    respondWith((url) =>
      url === ART_640 ? new Response(null, { status: 301, headers: { location: moved } }) : null
    );

    await expect(fetchImageDataUri(ART_640)).resolves.toMatch(/^data:image\/jpeg;base64,/);
    expect(callsTo(moved)).toHaveLength(1);
  });

  it('リダイレクトが続くなら、上限（3回）で諦める', async () => {
    respondWith((url) =>
      url.includes('.scdn.co')
        ? new Response(null, { status: 302, headers: { location: `${url}x` } })
        : null
    );

    await expect(fetchImageDataUri(ART_640)).resolves.toBeNull();
    expect(callsTo('.scdn.co')).toHaveLength(4);
  });
});

describe('SVG の描画の細部', () => {
  const track = {
    id: 'track-1',
    name: 'Midnight Drive',
    artist: 'Neon District',
    album: 'After Hours',
    album_art_url: ART_640,
    duration_ms: 213_000,
    popularity: null,
    spotify_url: 'https://open.spotify.com/track/track-1',
    preview_url: null,
  };
  const idsOf = (svg: string) => new Set(Array.from(svg.matchAll(/ id="([^"]+)"/g), (match) => match[1]));

  it('ダークとライトの now-playing・ランキングを1つのページに並べても、id が重ならない', () => {
    const svgs = [
      renderNowPlayingCard({ state: 'playing', track, mood: null, artDataUri: 'data:image/jpeg;base64,AA==', theme: 'dark' }),
      renderNowPlayingCard({ state: 'playing', track, mood: null, artDataUri: 'data:image/jpeg;base64,AA==', theme: 'light' }),
      renderRankingCard({ tracks: [aTopTrackEntry()], fetchedAt: NOW_ISO, theme: 'dark', artDataUris: ['data:image/jpeg;base64,AA=='] }),
      renderRankingCard({ tracks: [aTopTrackEntry()], fetchedAt: NOW_ISO, theme: 'light', artDataUris: ['data:image/jpeg;base64,AA=='] }),
    ];
    const all = svgs.flatMap((svg) => [...idsOf(svg)]);

    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length);
  });

  it('同じ内容なら同じ id になる（静的モードの出力が実行のたびに変わらない）', () => {
    const render = () => renderNowPlayingCard({ state: 'playing', track, mood: null, artDataUri: 'data:image/jpeg;base64,AA==' });

    expect(render()).toBe(render());
  });

  it.each(['playing', 'recent'] as const)('state: %s で track が null なら、ジャケ写の枠を描かずに曲なしのカードにする', (state) => {
    const svg = renderNowPlayingCard({ state, track: null, mood: null });

    expect(svg).not.toContain('no art');
    expect(svg).toContain('再生していません');
    expect(svg).toContain('NOTHING PLAYING');
  });

  it('ランキングの順位は、配列の位置ではなく track.rank を描く', () => {
    const svg = renderRankingCard({ tracks: [aTopTrackEntry({ rank: 7 })], fetchedAt: NOW_ISO });

    expect(svg).toMatch(/text-anchor="end">7<\/text>/);
    expect(svg).toContain('7位');
  });

  it('「no art」の文字色は、両テーマで枠の色に対して 4.5:1 以上', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((index) => {
        const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const name of ['dark', 'light'] as const) {
      const svg = renderNowPlayingCard({ state: 'playing', track, mood: null, theme: name });
      const color = /fill="(#[0-9a-f]{6})"[^>]*aria-hidden="true">no art/.exec(svg)?.[1] ?? '';
      const [hi, lo] = [luminance(color), luminance(THEMES[name].placeholder)].sort((x, y) => y - x) as [number, number];
      expect((hi + 0.05) / (lo + 0.05), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ムード文の無いカードの曲名は、空白の無い長い名前でも枠の中で折り返す（/embed と embed.js）', () => {
    const embedJs = readFileSync(new URL('../../public/embed.js', import.meta.url), 'utf8');
    const html = renderEmbedPage({ nowPlaying: { is_playing: true, track, mood: null, fetched_at: NOW_ISO }, state: 'playing' });

    expect(html).toMatch(/\.card\[data-no-mood\] \.track \{[^}]*overflow-wrap: anywhere/);
    expect(embedJs).toMatch(/\.card\.no-mood \.track \{[^}]*overflow-wrap: anywhere/);
  });
});

describe('折り返しの細部', () => {
  it('最終行に詰めるとき、折った位置の空白を保つ（単語どうしをつなげない）', () => {
    const lines = wrapToWidth('aaaa bbbb cc dd', 4, 2);

    expect(lines[1]).toMatch(/^bbbb c/);
    for (const line of lines) expect(visualWidth(line)).toBeLessThanOrEqual(4);
  });

  it('日本語の文を折り返して省略しても、余計な空白が入らない', () => {
    const lines = wrapToWidth('夜に似合う曲ばかり聴いているようです', 6, 2);

    expect(lines.join('')).not.toContain(' ');
    expect(lines[1]?.endsWith('…')).toBe(true);
  });

  it.each([
    ['ギリシャ文字', 'Καλημέρα κόσμε'],
    ['キリル文字', 'Привет мир'],
    ['ベトナム語', 'Xin chào thế giới'],
  ])('%s の単語は、収まる幅なら単語の途中で折らない', (_name, text) => {
    const words = text.split(' ');
    const lines = wrapToWidth(text, 7, 5);

    for (const line of lines) {
      for (const piece of line.split(' ')) expect(words).toContain(piece);
    }
  });

  it('大文字の多い英語の曲名は、小文字より幅を大きく見積もる（カードの右端からはみ出さない）', () => {
    expect(visualWidth('WWWWWWWWWW')).toBeGreaterThan(visualWidth('wwwwwwwwww'));
    expect(visualWidth('MIDNIGHT DRIVE')).toBeGreaterThan(visualWidth('midnight drive'));
  });
});

describe('透過の /embed の配色', () => {
  const nowPlaying = { is_playing: false, track: null, mood: null, fetched_at: NOW_ISO };

  it('transparent なら color-scheme を light dark にし、埋め込み先と配色が違っても背景が透けるようにする', () => {
    const html = renderEmbedPage({ nowPlaying, state: 'idle', theme: 'dark', transparent: true });

    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });

  it('transparent でなければ、今までどおりテーマ名', () => {
    expect(renderEmbedPage({ nowPlaying, state: 'idle', theme: 'light' })).toContain('<meta name="color-scheme" content="light">');
  });
});

describe('ランキングの「◯◯時点」の日付の出どころ', () => {
  it('現在時刻ではなく fetched_at から作る', () => {
    const svg = renderRankingCard({ tracks: [aTopTrackEntry()], fetchedAt: '2026-01-02T00:00:00.000Z' });

    expect(svg).toContain('2026-01-02 時点');
    expect(svg).not.toContain('2026-09-21 時点');
  });
});

describe('日付の表示は日本時間の境界で切り替わる', () => {
  it.each([
    ['2026-09-21T14:59:00.000Z', '2026-09-21', '9/21 23:59'],
    ['2026-09-21T15:00:00.000Z', '2026-09-22', '9/22 00:00'],
    ['2026-12-31T14:59:00.000Z', '2026-12-31', '12/31 23:59'],
    ['2026-12-31T15:00:00.000Z', '2027-01-01', '1/1 00:00'],
  ])('%s → %s / %s', (iso, date, dateTime) => {
    expect(formatDateJa(new Date(iso))).toBe(date);
    expect(formatDateTimeJa(new Date(iso))).toBe(dateTime);
  });
});

describe('ランキング SVG の見出しは、ムード文の行数が変わっても行に重ならない', () => {
  function positions(moodText: string | null) {
    const svg = renderRankingCard({
      tracks: [aTopTrackEntry()],
      fetchedAt: NOW_ISO,
      mood: moodText ? { text: moodText, generated_at: NOW_ISO } : null,
    });
    const moodYs = [...svg.matchAll(/y="(\d+)" font-size="15"/g)].map((match) => Number(match[1]));
    const lineY = Number(/<line [^>]*y1="(\d+)"/.exec(svg)?.[1]);
    const firstRowY = Number(/y="(\d+)"[^>]*text-anchor="end">1</.exec(svg)?.[1]);
    return { moodYs, lineY, firstRowY };
  }

  it.each([
    ['0行', null, 0],
    ['1行', '静かな夜のようです', 1],
    ['2行', 'とても長いムード文がカードの幅に収まらずに二行目まで折り返されていくようなランキングです', 2],
  ])('ムード文が%s', (_label, text, lines) => {
    const { moodYs, lineY, firstRowY } = positions(text);

    expect(moodYs).toHaveLength(lines);
    expect(Math.max(0, ...moodYs)).toBeLessThan(lineY);
    expect(lineY).toBeLessThan(firstRowY);
  });
});

describe('ジャケ写の URL のサイズの差し替え', () => {
  const url = (size: 640 | 300 | 64) => `https://i.scdn.co/image/${SIZE_PREFIX[size]}abc`;

  it.each([
    [640, 300],
    [300, 64],
    [64, 640],
  ] as const)('%d → %d', (from, to) => {
    expect(albumArtAtSize(url(from), to)).toBe(url(to));
  });

  it.each(['https://example.com/unknown.jpg', ''])('知らない形式（%j）はそのまま', (value) => {
    expect(albumArtAtSize(value, 300)).toBe(value);
  });

  it('embed.js のコピーは image.ts の定義と一致する', () => {
    const embedJs = readFileSync(new URL('../../public/embed.js', import.meta.url), 'utf8');
    for (const [size, prefix] of Object.entries(SIZE_PREFIX)) {
      expect(embedJs).toContain(`${size}: '${prefix}'`);
    }
  });
});

describe('now-playing の SVG カードの組み方', () => {
  const track = {
    id: 't',
    name: '短い曲',
    artist: 'アーティスト',
    album: 'アルバム',
    album_art_url: '',
    duration_ms: 1,
    popularity: null,
    spotify_url: 'https://open.spotify.com/track/t',
    preview_url: null,
  };
  const yOf = (svg: string, text: string) => Number(new RegExp(`y="([\\d.]+)"[^>]*>${text}<`).exec(svg)?.[1]);
  const LONG = 'とても長い文字列がカードの幅に収まらずに二行目まで折り返されていくことを確かめます';

  it('ムード文が1行なら y=82、曲名とアーティストはその下の決まった位置', () => {
    const svg = renderNowPlayingCard({ track, mood: { text: '静かな夜のようです', generated_at: NOW_ISO }, state: 'playing' });

    expect(yOf(svg, '静かな夜のようです')).toBe(82);
    expect(yOf(svg, '短い曲')).toBe(124);
    expect(yOf(svg, 'アーティスト')).toBe(142);
  });

  it('ムード文が2行なら y=72 から2行', () => {
    const svg = renderNowPlayingCard({ track, mood: { text: LONG, generated_at: NOW_ISO }, state: 'playing' });

    expect(svg.match(/font-size="19"/g)).toHaveLength(2);
    expect(svg).toMatch(/y="72"[^>]*font-size="19"/);
    expect(svg).toMatch(/y="95"[^>]*font-size="19"/);
  });

  it('ムード文が無く曲名が1行なら、アーティストは曲名の直下', () => {
    const svg = renderNowPlayingCard({ track, mood: null, state: 'playing' });

    expect(yOf(svg, '短い曲')).toBe(84);
    expect(yOf(svg, 'アーティスト')).toBe(108);
  });

  it('ムード文が無く曲名が2行なら、アーティストは2行目の直下に下がる', () => {
    const svg = renderNowPlayingCard({ track: { ...track, name: LONG }, mood: null, state: 'playing' });

    expect(svg).toMatch(/y="74"[^>]*font-size="17"/);
    expect(yOf(svg, 'アーティスト')).toBe(74 + 21 + 24);
  });

  it('取得できなかったときは、ジャケ写も枠も描かず文言だけを出す', () => {
    const svg = renderNowPlayingCard({ track, mood: null, state: 'playing', unavailable: true });

    expect(svg).toContain('取得できませんでした');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('no art');
  });

  it('背景は既定で透過、transparent: false なら theme の色で塗る', () => {
    const fillOf = (svg: string) => /<rect x="0\.5"[^>]*fill="([^"]+)"/.exec(svg)?.[1];

    expect(fillOf(renderNowPlayingCard({ track, mood: null, state: 'playing' }))).toBe('none');
    expect(fillOf(renderNowPlayingCard({ track, mood: null, state: 'playing', transparent: false }))).toBe(THEMES.dark.bg);
  });
});

describe('iframe 用ページのランキング', () => {
  const entries = Array.from({ length: 60 }, (_, index) => aTopTrackEntry({ rank: index + 1, id: `t${index}`, name: `曲${index + 1}` }));
  const page = (rankingCount: number | undefined, overrides: object = {}) =>
    renderEmbedPage({
      nowPlaying: { is_playing: false, track: null, mood: null, fetched_at: NOW_ISO },
      state: 'idle',
      rankingCount,
      topTracks: { range: 'medium_term', tracks: entries, mood: null, fetched_at: '2026-09-21T15:00:00.000Z', ...overrides },
    } as Parameters<typeof renderEmbedPage>[0]);
  const rows = (html: string) => html.match(/<li>/g)?.length ?? 0;

  it.each([
    [0, 1],
    [51, 50],
    [3, 3],
  ])('rankingCount=%d なら %d 件にする', (count, expected) => {
    expect(rows(page(count))).toBe(expected);
  });

  it('見出しに期間と、日本時間の日付を出す', () => {
    const html = page(1);

    expect(html).toContain('TOP TRACKS · 6 MONTHS');
    expect(html).toContain('2026-09-22 時点');
  });

  it('ムード文があるときだけ見出しに出す', () => {
    const text = '夜に似合う曲ばかりのようです';

    expect(page(1)).not.toContain('class="ranking-mood"');
    expect(page(1, { mood: { text, generated_at: NOW_ISO } })).toContain(text);
  });

  it('spotify_url が https でない曲はリンクにしない', () => {
    const html = page(1, { tracks: [aTopTrackEntry({ spotify_url: 'javascript:alert(1)' })] });

    expect(html).not.toContain('javascript:alert(1)');
  });

  it('順位は track.rank を出す（SVG と同じ値）', () => {
    const tracks = [aTopTrackEntry({ rank: 7 })];

    expect(page(1, { tracks })).toContain('<span class="rank">7</span>');
    expect(renderRankingCard({ tracks, fetchedAt: NOW_ISO })).toContain('7位');
  });
});

describe('SVG のジャケ写の data URI', () => {
  it('属性としてエスケープする（呼び出し側の約束だけに頼らない）', () => {
    const svg = renderRankingCard({ tracks: [aTopTrackEntry()], fetchedAt: NOW_ISO, artDataUris: ['data:image/png;base64,"><x'] });

    expect(svg).toContain('&quot;&gt;&lt;x');
    expect(svg).not.toContain('"><x');
  });
});

describe('ページの読み上げ', () => {
  const entries = [aTopTrackEntry({ rank: 1, name: '曲A', artist: '人A' })];
  const page = (overrides: object = {}) =>
    renderEmbedPage({
      nowPlaying: { is_playing: false, track: null, mood: null, fetched_at: NOW_ISO },
      state: 'idle',
      topTracks: { range: 'short_term', tracks: entries, mood: null, fetched_at: NOW_ISO },
      ...overrides,
    } as Parameters<typeof renderEmbedPage>[0]);
  const track = {
    id: 't',
    name: '曲',
    artist: '人',
    album: 'A',
    album_art_url: '',
    duration_ms: 1,
    popularity: null,
    spotify_url: 'https://open.spotify.com/track/t',
    preview_url: null,
  };

  it('ランキングは見出しつきのリストとして読まれ、リンクは行き先を伝える', () => {
    const html = page();

    expect(html).toContain('<ol role="list">');
    expect(html).toContain('<section class="ranking" aria-labelledby="ranking-title">');
    expect(html).toContain('<h2 class="ranking-title" id="ranking-title">');
    expect(html).toContain('aria-label="1位 曲A / 人A（Spotifyで開く）"');
  });

  it('ランキングのジャケ写は見えてから読む', () => {
    const html = page({ topTracks: { range: 'short_term', tracks: [aTopTrackEntry({ album_art_url: ART_640 })], mood: null, fetched_at: NOW_ISO } });

    expect(html).toMatch(/<img [^>]*loading="lazy"/);
  });

  it('曲の無いカードの「no art」は読み上げない', () => {
    expect(page()).toContain('<div class="art-placeholder" aria-hidden="true">no art</div>');
  });

  it('最後に聴いた曲の読み上げに日時を入れる（ページと SVG）', () => {
    const since = '2026-10-16T12:04:00.000Z';
    const html = page({ nowPlaying: { is_playing: false, track, mood: null, fetched_at: NOW_ISO }, state: 'recent', since });

    expect(html).toContain('aria-label="最後に再生（10/16 21:04）: 曲 / 人（Spotifyで開く）"');
    expect(renderNowPlayingCard({ track, mood: null, state: 'recent', since })).toContain('aria-label="最後に再生（10/16 21:04）: 曲 / 人"');
  });
});

describe('<script> に埋め込む値', () => {
  it('</script> で閉じられない形にする', () => {
    const json = jsonForScript('</script><img src=x>');

    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toBe('</script><img src=x>');
  });
});
