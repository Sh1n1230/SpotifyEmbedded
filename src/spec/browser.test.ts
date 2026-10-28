// @vitest-environment jsdom
/**
 * ブラウザで動くスクリプト（/embed のライブ更新・public/embed.js・public/demo.js）。方針は ./support.ts の冒頭を参照。
 *
 * jsdom の上で実際のソースを実行する。fetch は support.ts のモック、タイマーは vitest の
 * 偽タイマーで進める。location は jsdom では差し替えられないので、引数で渡して観察する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApp } from '../app.js';
import { renderEmbedPage } from '../render/page.js';
import type { NowPlayingResponse } from '../types/index.js';
import { NOW, NOW_ISO, ART_640, respondWith, jsonOk, callsTo, aSpotifyTrack, givenNowPlaying } from './support.js';

/** jsdom の環境では URL が jsdom のものになり readFileSync に渡せないので、文字列のパスにする。 */
function readRepoFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url).href), 'utf8');
}

/** 配布物・生成したスクリプトのソースを、そのまま jsdom の上で実行する。args は引数として渡す名前と値。 */
function runScript(source: string, args: Record<string, unknown> = {}): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- 自分のリポジトリのソースを動かすため
  const run = new Function(...Object.keys(args), source) as (...values: unknown[]) => void;
  run(...Object.values(args));
}

let hidden = false;

/** 前のテストで動かしたスクリプトの listener を残さない（jsdom の document はファイル内で共有される）。 */
const listeners: [string, EventListenerOrEventListenerObject][] = [];
const addEventListener = document.addEventListener.bind(document);

beforeEach(() => {
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push([type, listener]);
    addEventListener(type, listener, options);
  });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.title = '';
});

afterEach(() => {
  for (const [type, listener] of listeners.splice(0)) document.removeEventListener(type, listener);
});

function setHidden(value: boolean): void {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** 応答を返して、then の連鎖が進み切るまで待つ。 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function nowPlayingCalls() {
  return callsTo('/api/now-playing');
}

/** /api/now-playing の応答を順に返す（最後のものを繰り返す）。 */
function givenLiveResponses(...responses: (NowPlayingResponse | number | 'hang')[]): void {
  let i = 0;
  respondWith((url, init) => {
    if (!url.includes('/api/now-playing')) return null;
    const next = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    if (next === 'hang') {
      // 応答しない相手。AbortSignal で打ち切られたら fetch と同じく reject する
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }) as unknown as Response;
    }
    return typeof next === 'number' ? new Response('{}', { status: next }) : jsonOk(next);
  });
}

function aNowPlaying(
  name: string,
  moodText: string | null,
  overrides: Partial<NonNullable<NowPlayingResponse['track']>> = {}
): NowPlayingResponse {
  return {
    is_playing: true,
    track: {
      id: name,
      name,
      artist: 'Neon District',
      album: 'After Hours',
      album_art_url: ART_640,
      duration_ms: 213_000,
      popularity: null,
      spotify_url: `https://open.spotify.com/track/${name}`,
      preview_url: null,
      ...overrides,
    },
    mood: moodText ? { text: moodText, generated_at: NOW_ISO } : null,
    fetched_at: NOW_ISO,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('/embed のライブ更新', () => {
  /** 初期表示 initial で描いたページを開き、ライブ更新のスクリプトを動かす。 */
  function openEmbed(initial: NowPlayingResponse, refreshSeconds = 30) {
    const html = renderEmbedPage({
      nowPlaying: initial,
      state: initial.is_playing && initial.track ? 'playing' : 'idle',
      liveEndpoint: '/api/now-playing',
      refreshSeconds,
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.title = doc.title;
    document.body.innerHTML = doc.body.innerHTML;
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const location = { reload: vi.fn() };
    runScript(script, { location });
    return { location, byId: (id: string) => document.getElementById(id) };
  }

  describe('表示を取得した内容と食い違わせない', () => {
    async function liveUpdate(initial: NowPlayingResponse, next: NowPlayingResponse) {
      givenLiveResponses(next);
      const page = openEmbed(initial);
      await vi.advanceTimersByTimeAsync(30_000);
      return page;
    }

    it('次の曲にムード文が無ければ、前の曲のムード文を残さない（読み込み直す）', async () => {
      const page = await liveUpdate(aNowPlaying('A', 'A のムード'), aNowPlaying('B', null));

      expect(page.location.reload).toHaveBeenCalled();
    });

    it('最初はムード文が無く、後からムード文が返ってきたら表示する（読み込み直す）', async () => {
      const page = await liveUpdate(aNowPlaying('A', null), aNowPlaying('A', 'あとから来たムード'));

      expect(page.location.reload).toHaveBeenCalled();
    });

    it('ムード文がある曲どうしなら、読み込み直さずに曲名・ムード文・aria-label・タイトルを差し替える', async () => {
      const page = await liveUpdate(aNowPlaying('A', 'A のムード'), aNowPlaying('B', 'B のムード'));

      expect(page.location.reload).not.toHaveBeenCalled();
      expect(page.byId('track')?.textContent).toBe('B');
      expect(page.byId('mood')?.textContent).toBe('B のムード');
      expect(page.byId('card')?.getAttribute('aria-label')).toBe(
        '再生中: B のムード — B / Neon District（Spotifyで開く）'
      );
      expect(document.title).toBe('Now Playing: B / Neon District');
    });

    it('ジャケ写のある曲 → 無い曲に変わったら、前の曲のジャケ写を残さない（読み込み直す）', async () => {
      const page = await liveUpdate(aNowPlaying('A', 'ムード'), aNowPlaying('B', 'ムード', { album_art_url: '' }));

      expect(page.location.reload).toHaveBeenCalled();
    });

    it('ジャケ写の無い曲 → ある曲に変わったら、ジャケ写を出す（読み込み直す）', async () => {
      const page = await liveUpdate(aNowPlaying('A', 'ムード', { album_art_url: '' }), aNowPlaying('B', 'ムード'));

      expect(page.location.reload).toHaveBeenCalled();
    });

    it('どちらもジャケ写のある曲なら、読み込み直さずに src だけ差し替える', async () => {
      const other = 'https://i.scdn.co/image/ab67616d0000b273cafebabecafebabecafebabe';
      const page = await liveUpdate(aNowPlaying('A', 'ムード'), aNowPlaying('B', 'ムード', { album_art_url: other }));

      expect(page.location.reload).not.toHaveBeenCalled();
      expect(page.byId('art')?.getAttribute('src')).toBe(
        'https://i.scdn.co/image/ab67616d00001e02cafebabecafebabecafebabe'
      );
    });
  });

  it('タブが非表示の間は API を叩かず、表示に戻ったらすぐ取り直す', async () => {
    givenLiveResponses(aNowPlaying('A', 'ムード'));
    openEmbed(aNowPlaying('A', 'ムード'));
    setHidden(true);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(nowPlayingCalls()).toHaveLength(0);

    setHidden(false);
    await settle();
    expect(nowPlayingCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(nowPlayingCalls()).toHaveLength(2);
  });

  it('応答しない取得は 10 秒で打ち切り、次の周期でまた取りに行く', async () => {
    givenLiveResponses('hang', aNowPlaying('A', 'ムード'));
    openEmbed(aNowPlaying('A', 'ムード'));

    await vi.advanceTimersByTimeAsync(30_000);
    const first = nowPlayingCalls()[0]!;
    expect(first.init?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(first.init?.signal?.aborted).toBe(true);

    // 1回失敗したので、次は間隔を倍（60 秒）にする
    await vi.advanceTimersByTimeAsync(59_000);
    expect(nowPlayingCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(nowPlayingCalls()).toHaveLength(2);
  });

  it('続けて失敗したら間隔を倍々に伸ばし、成功したら元に戻す', async () => {
    givenLiveResponses(502, 502, aNowPlaying('A', 'ムード'));
    openEmbed(aNowPlaying('A', 'ムード'));

    const fetchTimes: number[] = [];
    for (let elapsed = 0; elapsed <= 30_000 + 60_000 + 120_000 + 30_000; elapsed += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
      while (fetchTimes.length < nowPlayingCalls().length) fetchTimes.push(elapsed + 1_000);
    }

    // 30 秒後に失敗 → 60 秒後に失敗 → 120 秒後に成功 → 30 秒後
    expect(fetchTimes).toEqual([30_000, 90_000, 210_000, 240_000]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('embed.js（ワンタグ埋め込み）', () => {
  const source = readRepoFile('../../public/embed.js');

  /** 貼り付け先のページに <script src=".../embed.js" data-*> を置いて実行する。 */
  function embed(attributes: Record<string, string> = {}) {
    const script = document.createElement('script');
    script.src = 'https://api.example/embed.js';
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    document.body.appendChild(script);
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });
    runScript(source);
    const host = document.querySelector('.spotify-embedded')!;
    return {
      script,
      host,
      card: () => host.shadowRoot!.querySelector('.card'),
      text: () => host.shadowRoot!.textContent ?? '',
    };
  }

  it('API 由来の文字列は HTML として解釈せず、テキストとして出す', async () => {
    givenLiveResponses(aNowPlaying('<img src=x onerror=alert(1)>', '<b>ムード</b>'));

    const card = embed();
    await settle();

    expect(card.host.shadowRoot!.querySelector('img[src="x"]')).toBeNull();
    expect(card.host.shadowRoot!.querySelector('b')).toBeNull();
    expect(card.text()).toContain('<img src=x onerror=alert(1)>');
    expect(card.text()).toContain('<b>ムード</b>');
  });

  it('https でない URL はリンクにもジャケ写にも使わない', async () => {
    givenLiveResponses(
      aNowPlaying('A', 'ムード', { spotify_url: 'javascript:alert(1)', album_art_url: 'javascript:alert(2)' })
    );

    const card = embed();
    await settle();

    expect(card.card()?.tagName).toBe('DIV');
    expect(card.host.shadowRoot!.querySelector('[href]')).toBeNull();
    expect(card.host.shadowRoot!.querySelector('img')).toBeNull();
    expect(card.text()).toContain('no art');
  });

  it.each([
    ['1', 10_000],
    ['45', 45_000],
    ['99999', 3_600_000],
    ['abc', 30_000],
  ])('data-refresh="%s" は 10〜3600 秒に収め、%d ミリ秒ごとに取得する', async (refresh, expected) => {
    givenLiveResponses(aNowPlaying('A', 'ムード'));

    embed({ 'data-refresh': refresh });
    await settle();
    await vi.advanceTimersByTimeAsync(expected - 1);
    expect(nowPlayingCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(nowPlayingCalls()).toHaveLength(2);
  });

  it.each(['#', '#2024-card'])(
    'data-target="%s" のような不正なセレクタでも止まらず、スクリプトの直後に描いて警告する',
    async (target) => {
      givenLiveResponses(aNowPlaying('A', 'ムード'));

      const card = embed({ 'data-target': target });
      await settle();

      expect(card.script.nextElementSibling).toBe(card.host);
      expect(card.card()).not.toBeNull();
      expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain(target);
    }
  );

  it('正しいセレクタなら、その要素の中に描く', async () => {
    givenLiveResponses(aNowPlaying('A', 'ムード'));
    const mount = document.createElement('div');
    mount.id = 'spotify';
    document.body.appendChild(mount);

    const card = embed({ 'data-target': '#spotify' });
    await settle();

    expect(card.host.parentElement).toBe(mount);
  });

  describe('最初の取得に失敗したとき', () => {
    it('「取得できませんでした」のカードを出し、その後の取得が成功したら通常のカードに置き換える', async () => {
      givenLiveResponses(502, aNowPlaying('A', 'ムード'));

      const card = embed();
      await settle();
      expect(card.text()).toContain('UNAVAILABLE');
      expect(card.text()).toContain('取得できませんでした');
      expect(card.text()).toContain('no art');

      await vi.advanceTimersByTimeAsync(60_000);
      expect(card.text()).toContain('NOW PLAYING');
      expect(card.text()).not.toContain('取得できませんでした');
    });

    it('2回目以降の失敗では、前回のカードをそのまま残す', async () => {
      givenLiveResponses(aNowPlaying('A', 'ムード'), 502);

      const card = embed();
      await settle();
      const before = card.card();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(nowPlayingCalls()).toHaveLength(2);
      expect(card.card()).toBe(before);
      expect(card.text()).toContain('ムード');
    });
  });

  describe('更新しても、キーボードのフォーカスを失わせない', () => {
    it('同じ応答が続く間は、カードの要素を作り直さない', async () => {
      givenLiveResponses(aNowPlaying('A', 'ムード'));

      const card = embed();
      await settle();
      const first = card.card();
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(nowPlayingCalls()).toHaveLength(3);
      expect(card.card()).toBe(first);
    });

    it.each([
      ['曲', aNowPlaying('B', 'ムード')],
      ['再生状態', { ...aNowPlaying('A', 'ムード'), is_playing: false }],
      ['ムード文', aNowPlaying('A', '別のムード')],
    ])('%sが変わったら表示を更新する', async (_, next) => {
      givenLiveResponses(aNowPlaying('A', 'ムード'), next);

      const card = embed();
      await settle();
      const first = card.card();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(card.card()).not.toBe(first);
    });
  });

  it('タブが非表示の間は取得せず、続けて失敗したら間隔を伸ばす', async () => {
    givenLiveResponses(502);

    embed();
    await settle();
    expect(nowPlayingCalls()).toHaveLength(1);

    setHidden(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(nowPlayingCalls()).toHaveLength(1);

    setHidden(false);
    await settle();
    expect(nowPlayingCalls()).toHaveLength(2);

    // 2回続けて失敗したので 30 秒 × 4
    await vi.advanceTimersByTimeAsync(119_000);
    expect(nowPlayingCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(nowPlayingCalls()).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('デモ画面（public/demo.js）', () => {
  const source = readRepoFile('../../public/demo.js');

  function openDemo(): void {
    const html = readRepoFile('../../public/index.html');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    runScript(source);
  }

  it('曲を表示し、https でないジャケ写の URL は使わない', async () => {
    givenLiveResponses(aNowPlaying('A', 'ムード', { album_art_url: 'javascript:alert(1)' }));

    openDemo();
    await settle();

    expect(document.getElementById('track-name')?.textContent).toBe('A');
    expect(document.getElementById('mood-text')?.textContent).toBe('ムード');
    expect(document.getElementById('album-art')?.getAttribute('src')).toBeNull();
  });

  it('タブが非表示の間は取得せず、表示に戻ったらすぐ取り直す', async () => {
    givenLiveResponses(aNowPlaying('A', 'ムード'));

    openDemo();
    await settle();
    setHidden(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(nowPlayingCalls()).toHaveLength(1);

    setHidden(false);
    await settle();
    expect(nowPlayingCalls()).toHaveLength(2);
  });

  it('続けて失敗したら間隔を伸ばす', async () => {
    givenLiveResponses(502);

    openDemo();
    await settle();
    // 1回失敗したので次は 60 秒後
    await vi.advanceTimersByTimeAsync(59_000);
    expect(nowPlayingCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(nowPlayingCalls()).toHaveLength(2);

    // 2回続けて失敗したので次は 120 秒後
    await vi.advanceTimersByTimeAsync(119_000);
    expect(nowPlayingCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(nowPlayingCalls()).toHaveLength(3);
    expect(document.getElementById('status-msg')?.textContent).toBe('再生中の曲を取得できませんでした');
  });
});

describe('ライブAPIの /embed が実際に配るスクリプトも同じ方針で動く', () => {
  it('ページに埋め込まれたライブ更新は、タブが非表示なら取得しない', async () => {
    givenNowPlaying(aSpotifyTrack());
    const html = await (await createApp().request('/embed')).text();
    expect(html).toContain('visibilitychange');
    expect(html).toContain('AbortController');
  });
});
