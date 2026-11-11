/** 静的モード（generate）の成果物と、ライブAPIとのスキーマの一致（要件3・4）。方針は ./support.ts の冒頭を参照。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';

import { moodCache } from '../cache/index.js';
import { collectNowPlaying, collectTopTracks } from '../core/collect.js';
import { generate, forLog, SNAPSHOT_SCHEMA_VERSION } from '../cli/generate.js';
import { renderRankingCard } from '../render/ranking.js';
import { renderEmbedPage } from '../render/page.js';
import type { TopTrackEntry } from '../types/index.js';
import {
  NOW,
  NOW_ISO,
  respondWith,
  callsTo,
  installDefaultHandlers,
  clearHandlers,
  clearCalls,
  aSpotifyTrack,
  aTopTrackEntry,
  givenNowPlaying,
  givenRecentlyPlayed,
  givenTopTracks,
  givenLlmConfigured,
  givenLlmReplies,
  expectValidXml,
  must,
} from './support.js';

describe('要件3: ランキングの静的な画像を得られる', () => {
  function render(tracks: TopTrackEntry[], count = 5): string {
    return renderRankingCard({
      tracks,
      fetchedAt: NOW_ISO,
      range: 'short_term',
      count,
      theme: 'dark',
    });
  }

  it('XMLとして妥当なSVGを返す', () => {
    const svg = render([aTopTrackEntry()]);

    expectValidXml(svg);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Midnight Drive');
  });

  it('曲名やアーティスト名にXMLの特殊文字が入っても壊れない', () => {
    // ここが壊れると GitHub 上で画像が「表示されない」形で失敗する。
    // テキストノードだけでなく aria-label などの属性値にも差し込まれるため、
    // 正規表現ではなく実際にパースして確かめる。
    const nasty = 'Rock & Roll <script>alert("x")</script> \'quoted\'';
    const svg = render([aTopTrackEntry({ name: nasty, artist: nasty, album: nasty })]);

    expectValidXml(svg);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&amp;');
  });

  it('表示件数は count 件までに絞られる', () => {
    const tracks = Array.from({ length: 20 }, (_, i) =>
      aTopTrackEntry({ rank: i + 1, id: `track-${i}`, name: `Track ${i}` })
    );

    const svg = render(tracks, 3);

    expect(svg).toContain('Track 0');
    expect(svg).toContain('Track 2');
    expect(svg).not.toContain('Track 3');
  });

  it('1件も無いときは空白ではなく「データがありません」を描く', () => {
    const svg = render([]);

    expectValidXml(svg);
    expect(svg).toContain('データがありません');
    expect(svg).toMatch(/<desc id="rank-desc-[0-9a-z]+">データがありません<\/desc>/);
  });

  it('スクリーンリーダーにも、表示中の曲の順位・曲名・アーティストが <desc> で届く', () => {
    // role="img" の中の <text> は読まれないので、要約（<title>）だけでは曲が伝わらない
    const tracks = Array.from({ length: 5 }, (_, i) =>
      aTopTrackEntry({ rank: i + 1, id: `track-${i}`, name: `Song ${i} & <b>`, artist: `Artist ${i}` })
    );

    const svg = render(tracks, 3);

    expectValidXml(svg);
    const suffix = /aria-labelledby="rank-title-([0-9a-z]+)"/.exec(svg)?.[1];
    expect(svg).toMatch(
      new RegExp(`<svg [^>]*role="img"[^>]*aria-labelledby="rank-title-${suffix}"[^>]*aria-describedby="rank-desc-${suffix}"`)
    );
    expect(svg).toContain(`<title id="rank-title-${suffix}">`);
    expect(svg).toContain(
      `<desc id="rank-desc-${suffix}">1位 Song 0 &amp; &lt;b&gt; / Artist 0。2位 Song 1 &amp; &lt;b&gt; / Artist 1。3位 Song 2 &amp; &lt;b&gt; / Artist 2</desc>`
    );
    expect(svg).not.toContain('Artist 3');
  });

  it('集計期間が見出しに出る', () => {
    const svg = renderRankingCard({
      tracks: [aTopTrackEntry()],
      fetchedAt: NOW_ISO,
      range: 'long_term',
      count: 5,
    });

    expect(svg).toContain('1 YEAR');
  });

  it('「◯◯時点」の日付は、実行環境のタイムゾーンによらず日本時間で出る', () => {
    // GitHub Actions は UTC。21:30Z は日本時間で翌日の 6:30
    const originalTz = process.env['TZ'];
    process.env['TZ'] = 'UTC';
    try {
      const fetchedAt = '2026-10-16T21:30:00Z';
      const svg = renderRankingCard({
        tracks: [aTopTrackEntry()],
        fetchedAt,
        range: 'short_term',
        count: 5,
      });
      const html = renderEmbedPage({
        nowPlaying: { is_playing: false, track: null, mood: null, fetched_at: fetchedAt },
        topTracks: {
          range: 'short_term',
          limit: 10,
          fetched_at: fetchedAt,
          mood: null,
          tracks: [aTopTrackEntry()],
        },
        state: 'idle',
      });

      expect(svg).toContain('2026-10-17 時点');
      expect(svg).not.toContain('2026-10-16');
      expect(html).toContain('2026-10-17 時点');
    } finally {
      if (originalTz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = originalTz;
    }
  });

  it('dark / light の2テーマを描ける', () => {
    const dark = render([aTopTrackEntry()]);
    const light = renderRankingCard({
      tracks: [aTopTrackEntry()],
      fetchedAt: NOW_ISO,
      range: 'short_term',
      count: 5,
      theme: 'light',
    });

    expectValidXml(light);
    expect(light).not.toBe(dark);
  });
});

describe('要件4: GitHub Actions から定期的にランキング画像を更新できる', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'spotify-embedded-spec-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  function runGenerate(): Promise<void> {
    return generate({
      outDir,
      count: 5,
      range: 'short_term',
      limit: 50,
      theme: 'both',
      skipMood: true,
    });
  }

  function read(name: string): string {
    return readFileSync(join(outDir, name), 'utf8');
  }

  describe('生成される成果物', () => {
    it('SVG / JSON / YAML / HTML を出力先に書き出す', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      for (const name of [
        'now-playing.svg',
        'now-playing-light.svg',
        'ranking.svg',
        'ranking-light.svg',
        'now-playing.json',
        'top-tracks.json',
        'now-playing.yaml',
        'top-tracks.yaml',
        'last-played.json',
        'last-played.yaml',
        'index.html',
        'index-light.html',
        'snapshot.json',
      ]) {
        expect(read(name).length).toBeGreaterThan(0);
      }
    });

    it('GitHub Actions ではジョブのサマリーに結果を書き、曲名の Markdown を無効にする', async () => {
      const summary = join(outDir, 'summary.md');
      vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
      givenNowPlaying(aSpotifyTrack({ name: '[link](http://x)' }));
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      const text = readFileSync(summary, 'utf8');
      expect(text).toContain('状態: playing');
      expect(text).toContain('\\[link\\]\\(http://x\\)');
    });

    it('途中で失敗したら、前回の出力をそのまま残す', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();
      const before = read('now-playing.json');

      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenNowPlaying(aSpotifyTrack({ name: '別の曲' }));
      givenTopTracks([aSpotifyTrack()]);
      // 最後に書く一時ファイルの名前を塞いで、書き込みの途中で失敗させる
      mkdirSync(join(outDir, '.snapshot.json.tmp'));
      await expect(runGenerate()).rejects.toThrow();

      expect(read('now-playing.json')).toBe(before);
      expect(readdirSync(outDir).filter((name) => name.endsWith('.tmp'))).toEqual(['.snapshot.json.tmp']);
    });

    it('ジャケ写は同時に8枚までしか取りに行かない', async () => {
      const inner = fetch;
      let inFlight = 0;
      let peak = 0;
      vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
        if (!String(input).includes('.scdn.co')) return inner(input, init);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return inner(input, init);
      });
      givenNowPlaying(null);
      givenTopTracks(Array.from({ length: 30 }, (_, index) => aSpotifyTrack({ id: `t${index}` })));

      await generate({ outDir, count: 30, range: 'short_term', limit: 50, theme: 'dark', skipMood: true });

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(9); // ジャケ写の枠 8 ＋ カードの1枚
    });

    it.each([
      ['手元', '', true],
      ['CI', 'true', false],
    ])('%s の generate の最後の次の手順の案内', async (_label, ci, shown) => {
      vi.stubEnv('CI', ci);
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      expect(vi.mocked(console.log).mock.calls.flat().join('\n').includes('貼り方:')).toBe(shown);
    });

    it('各段階の所要時間をログに出す', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      const logs = vi.mocked(console.log).mock.calls.flat().join('\n');
      for (const label of ['再生状況', 'ランキング', 'ジャケ写']) expect(logs).toMatch(new RegExp(`${label}: \\d+ms`));
    });

    it('--out の出力先が無ければ、ネストしたパスでも作る', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      const nested = join(outDir, 'a', 'b', 'c');

      await generate({ outDir: nested, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: true });

      expect(readFileSync(join(nested, 'ranking.svg'), 'utf8').length).toBeGreaterThan(0);
    });

    it('一部のジャケ写が取れなくても、ランキング SVG は完成し、その曲の行だけプレースホルダになる', async () => {
      const artOf = (url: string) => ({ url, width: 640, height: 640 });
      givenNowPlaying(null);
      givenTopTracks([
        aSpotifyTrack({ id: 'ok', album: { name: 'A', images: [artOf('https://i.scdn.co/image/ok')], release_date: '' } }),
        aSpotifyTrack({ id: 'ng', album: { name: 'B', images: [artOf('https://i.scdn.co/image/broken')], release_date: '' } }),
      ]);
      respondWith((url) => (url.includes('/image/broken') ? new Response('gone', { status: 404 }) : null));

      await runGenerate();

      const svg = read('ranking.svg');
      expectValidXml(svg);
      expect(svg.match(/<image /g)).toHaveLength(1);
    });

    it('--count より曲が少なければ、ランキングの行数と読み上げは実際の曲数になる', async () => {
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack({ id: 'a', name: '曲A' }), aSpotifyTrack({ id: 'b', name: '曲B' })]);

      await runGenerate();

      const svg = read('ranking.svg');
      expect(svg).toContain('トップトラック2件');
      expect(svg).toContain('2位 曲B');
      expect(svg).not.toContain('3位');
    });

    it.each([
      ['--count', { count: 30 }],
      ['--page-count', { count: 5, pageCount: 30 }],
    ])('%s が --limit を超える指定は、取得を始める前にエラーにする（出力先も作らない）', async (flag, counts) => {
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      const target = join(outDir, 'not-created');

      await expect(
        generate({ outDir: target, range: 'short_term', limit: 10, theme: 'dark', skipMood: true, ...counts })
      ).rejects.toThrow(`${flag} 30 は --limit 10 を超えています`);

      expect(callsTo('api.spotify.com')).toHaveLength(0);
      expect(readdirSync(outDir)).toEqual([]);
    });

    it('--page-count で、iframe 用ページのランキングだけ別の件数にできる（既定は --count と同じ）', async () => {
      givenNowPlaying(null);
      givenTopTracks(Array.from({ length: 4 }, (_, i) => aSpotifyTrack({ id: `t${i}`, name: `曲${i + 1}` })));

      await generate({ outDir, count: 2, pageCount: 4, range: 'short_term', limit: 10, theme: 'dark', skipMood: true });

      expect(read('ranking.svg')).not.toContain('曲3');
      expect(read('index.html')).toContain('曲4');

      await generate({ outDir, count: 2, range: 'short_term', limit: 10, theme: 'dark', skipMood: true });
      expect(read('index.html')).not.toContain('曲3');
    });

    describe('ランキングの取得が失敗した回', () => {
      function givenTopTracksFail(): void {
        respondWith((url) => (url.includes('/me/top/tracks') ? new Response('boom', { status: 500 }) : null));
      }

      it('再生状況のファイルは更新し、ランキングのファイルは前回のまま残す（失敗にしない）', async () => {
        givenNowPlaying(aSpotifyTrack());
        givenTopTracks([aSpotifyTrack({ name: '前回の1位' })]);
        await runGenerate();
        const before = { svg: read('ranking.svg'), json: read('top-tracks.json'), yaml: read('top-tracks.yaml') };

        vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000));
        givenNowPlaying(aSpotifyTrack({ id: 'track-2', name: '新しい曲' }));
        givenTopTracksFail();
        await runGenerate();

        expect(read('ranking.svg')).toBe(before.svg);
        expect(read('top-tracks.json')).toBe(before.json);
        expect(read('top-tracks.yaml')).toBe(before.yaml);
        for (const name of ['now-playing.svg', 'now-playing.json', 'last-played.json', 'snapshot.json']) {
          expect(read(name), name).toContain('新しい曲');
        }
        // iframe 用ページには前回のランキングを出す
        expect(read('index.html')).toContain('新しい曲');
        expect(read('index.html')).toContain('前回の1位');
        expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('ランキングを取得できませんでした');
      });

      it('前回のランキングが無ければ、ランキングのファイルを作らず、ページはランキングなしになる', async () => {
        givenNowPlaying(aSpotifyTrack());
        givenTopTracksFail();

        await runGenerate();

        expect(readdirSync(outDir).filter((name) => /ranking|top-tracks/.test(name))).toEqual([]);
        expect(read('index.html')).not.toContain('TOP TRACKS');
        expect(read('now-playing.json')).toContain('Midnight Drive');
      });

      it('ランキングのムード文の記録は消さない（次に取れた回で使い回す）', async () => {
        givenLlmConfigured();
        givenLlmReplies('一回目の文');
        givenNowPlaying(null);
        givenTopTracks([aSpotifyTrack()]);
        await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

        givenTopTracksFail();
        await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

        const snapshot = JSON.parse(read('snapshot.json')) as { ranking_mood: { mood: { text: string } } };
        expect(snapshot.ranking_mood.mood.text).toBe('一回目の文');
      });
    });

    describe('ランキングのムード文の記録（snapshot.json の ranking_mood）は、作らない回でも残す', () => {
      const withMood = { count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false } as const;

      async function firstRun(): Promise<void> {
        givenLlmConfigured();
        givenLlmReplies('一回目の文');
        givenNowPlaying(null);
        givenTopTracks([aSpotifyTrack()]);
        await generate({ outDir, ...withMood });
        clearCalls();
        givenLlmReplies('作り直された文');
      }
      const rankingMoodText = () =>
        (JSON.parse(read('snapshot.json')) as { ranking_mood: { mood: { text: string } } | null }).ranking_mood?.mood.text;
      const shownMood = () => (JSON.parse(read('top-tracks.json')) as { mood: { text: string } | null }).mood;

      it('--no-mood の回は表示しないが記録は残し、次の通常の回は LLM を呼ばずに使い回す', async () => {
        await firstRun();

        await generate({ outDir, ...withMood, skipMood: true });
        expect(shownMood()).toBeNull();
        expect(rankingMoodText()).toBe('一回目の文');

        await generate({ outDir, ...withMood });
        expect(shownMood()?.text).toBe('一回目の文');
        expect(callsTo('/chat/completions')).toHaveLength(0);
      });

      it('上位曲が0件だった回も同じ', async () => {
        await firstRun();

        givenTopTracks([]);
        await generate({ outDir, ...withMood });
        expect(shownMood()).toBeNull();
        expect(rankingMoodText()).toBe('一回目の文');

        givenTopTracks([aSpotifyTrack()]);
        await generate({ outDir, ...withMood });
        expect(shownMood()?.text).toBe('一回目の文');
        expect(callsTo('/chat/completions')).toHaveLength(0);
      });

      it('--refresh-ranking-mood は、顔ぶれが同じでも作り直す', async () => {
        await firstRun();

        await generate({ outDir, ...withMood, refreshRankingMood: true });

        expect(shownMood()?.text).toBe('作り直された文');
        expect(rankingMoodText()).toBe('作り直された文');
      });

      it('--refresh-ranking-mood で LLM が失敗したら、前回の文を残す', async () => {
        await firstRun();
        respondWith((url) => (url.includes('/chat/completions') ? new Response('busy', { status: 503 }) : null));

        await generate({ outDir, ...withMood, refreshRankingMood: true });

        expect(rankingMoodText()).toBe('一回目の文');
      });
    });

    describe('snapshot.json は内部の状態ファイル', () => {
      it('形の版と、書いた generate の版を持ち、ログ用の source は持たない', async () => {
        const { VERSION } = await import('../version.js');
        givenNowPlaying(null);
        givenTopTracks([aSpotifyTrack()]);
        givenRecentlyPlayed(aSpotifyTrack(), new Date(NOW.getTime() - 60_000).toISOString());

        await runGenerate();

        const snapshot = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
        expect(snapshot['schema_version']).toBe(SNAPSHOT_SCHEMA_VERSION);
        expect(snapshot['generator_version']).toBe(VERSION);
        expect(snapshot['state']).toBe('recent');
        expect(snapshot).not.toHaveProperty('source');
      });

      it('自分より新しい版が書いた snapshot.json は読まずに作り直す', async () => {
        writeFileSync(
          join(outDir, 'snapshot.json'),
          JSON.stringify({
            schema_version: SNAPSHOT_SCHEMA_VERSION + 1,
            state: 'playing',
            track: aTopTrackEntry({ name: '未来の形の曲' }),
            mood: null,
            observed_at: NOW_ISO,
          })
        );
        givenNowPlaying(null);
        givenTopTracks([aSpotifyTrack()]);

        await runGenerate();

        expect((JSON.parse(read('snapshot.json')) as { state: string }).state).toBe('idle');
        expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('新しい版');
      });

      it('版の無い（これまでの）snapshot.json は今までどおり読める', async () => {
        writeFileSync(
          join(outDir, 'snapshot.json'),
          JSON.stringify({ state: 'playing', source: 'carried', track: aTopTrackEntry({ name: '前の版の曲' }), mood: null, observed_at: NOW_ISO })
        );
        givenNowPlaying(null);
        givenTopTracks([aSpotifyTrack()]);

        await runGenerate();

        expect(read('snapshot.json')).toContain('前の版の曲');
      });
    });

    it('中身が前回と同じファイルは書き直さない', async () => {
      const { statSync, utimesSync } = await import('node:fs');
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();
      const old = new Date(NOW.getTime() - 86_400_000);
      for (const name of ['ranking.svg', 'now-playing.json']) utimesSync(join(outDir, name), old, old);
      vi.mocked(console.log).mockClear();

      // 時刻が進むと fetched_at を含む JSON は変わるが、同じ日のランキング SVG は変わらない
      vi.setSystemTime(new Date(NOW.getTime() + 60_000));
      await runGenerate();

      expect(statSync(join(outDir, 'ranking.svg')).mtimeMs).toBe(old.getTime());
      expect(statSync(join(outDir, 'now-playing.json')).mtimeMs).not.toBe(old.getTime());
      const logged = vi.mocked(console.log).mock.calls.flat().join('\n');
      expect(logged).toContain('= ranking.svg（変更なし）');
      expect(logged).toContain('✓ now-playing.json');
    });

    describe('検索エンジンへの掲載', () => {
      it('既定では index.html に noindex を入れ、robots.txt（Disallow: /）を書く', async () => {
        givenNowPlaying(aSpotifyTrack());
        givenTopTracks([aSpotifyTrack()]);

        await runGenerate();

        expect(read('index.html')).toContain('<meta name="robots" content="noindex">');
        expect(read('index-light.html')).toContain('<meta name="robots" content="noindex">');
        expect(read('robots.txt')).toBe('User-agent: *\nDisallow: /\n');
      });

      it('--index なら noindex を入れず、以前の実行が書いた robots.txt を消す（利用者が置いたものは触らない）', async () => {
        givenNowPlaying(aSpotifyTrack());
        givenTopTracks([aSpotifyTrack()]);
        await runGenerate();

        await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'both', skipMood: true, allowIndexing: true });
        expect(read('index.html')).not.toContain('name="robots"');
        expect(readdirSync(outDir)).not.toContain('robots.txt');

        writeFileSync(join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
        await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'both', skipMood: true, allowIndexing: true });
        expect(read('robots.txt')).toBe('User-agent: *\nAllow: /\n');
      });
    });

    it('再生中のカードとページには、観測した時刻を出す（数時間おきの生成なので「今」ではない）', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      // NOW は日本時間の 9/21 21:00
      expect(read('now-playing.svg')).toContain('NOW PLAYING · 9/21 21:00');
      expect(read('index.html')).toContain('NOW PLAYING · 9/21 21:00');
    });

    it.each(['yes', 'null', '123', '- dash', 'a: b'])('曲名が %j でも、YAML を読み戻した値は JSON と一致する', async (name) => {
      givenNowPlaying(aSpotifyTrack({ name }));
      givenTopTracks([aSpotifyTrack({ name })]);

      await runGenerate();

      for (const base of ['now-playing', 'top-tracks', 'last-played']) {
        expect(yaml.load(read(`${base}.yaml`))).toEqual(JSON.parse(read(`${base}.json`)));
      }
    });

    it('snapshot.json の ranking_mood だけが壊れていても、生成を続けてムード文を作り直す', async () => {
      const options = { outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false } as const;
      givenLlmConfigured();
      givenLlmReplies('最初の文のようです');
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      await generate(options);
      const snapshot = JSON.parse(read('snapshot.json')) as { ranking_mood: { track_ids: unknown } };
      snapshot.ranking_mood.track_ids = 'broken';
      writeFileSync(join(outDir, 'snapshot.json'), JSON.stringify(snapshot));

      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenLlmReplies('作り直した文のようです');
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      await generate(options);

      const after = JSON.parse(read('snapshot.json')) as { ranking_mood: { mood: { text: string } } };
      expect(after.ranking_mood.mood.text).toBe('作り直した文のようです');
    });

    it('iframe 用ページは、SVG と同じくダーク（index.html）とライト（index-light.html）の両方を書き出す', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      expect(read('index.html')).toContain('<meta name="color-scheme" content="dark">');
      expect(read('index-light.html')).toContain('<meta name="color-scheme" content="light">');
    });

    it('書き出したSVGはXMLとして妥当である', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      for (const name of ['now-playing.svg', 'ranking.svg', 'ranking-light.svg']) {
        expectValidXml(read(name));
      }
    });

    it('ジャケ写は外部参照ではなく data URI として焼き込まれる', async () => {
      // GitHub の camo プロキシは SVG 内の外部 <image href> を描画しない。
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      expect(read('ranking.svg')).toContain('data:image/jpeg;base64,');
      expect(read('ranking.svg')).not.toContain('href="https://i.scdn.co');
    });
  });

  describe('last-played.json / .yaml（カードと同じ「最後に聴いた曲」）', () => {
    function lastPlayed(): Record<string, unknown> {
      const json = JSON.parse(read('last-played.json')) as Record<string, unknown>;
      // YAML は JSON と同じ中身
      expect(yaml.load(read('last-played.yaml'))).toEqual(json);
      return json;
    }

    it('停止中は、再生履歴から最後に聴いた曲・ムード文・聴き終えた時刻が取れる', async () => {
      const playedAt = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      givenRecentlyPlayed(aSpotifyTrack(), playedAt);

      await runGenerate();

      const last = lastPlayed();
      expect(Object.keys(last).sort()).toEqual(['mood', 'played_at', 'track']);
      expect((last['track'] as { name: string }).name).toBe('Midnight Drive');
      expect(last['played_at']).toBe(playedAt);
      expect(last['mood']).toBeNull(); // skipMood
      expect(read('now-playing.svg')).toContain('Midnight Drive');
    });

    it('now-playing.json は今までどおり生の応答のまま（停止中は track: null）', async () => {
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      givenRecentlyPlayed(aSpotifyTrack(), new Date(NOW.getTime() - 60 * 1000).toISOString());

      await runGenerate();

      const nowPlaying = JSON.parse(read('now-playing.json')) as Record<string, unknown>;
      expect(Object.keys(nowPlaying).sort()).toEqual(['fetched_at', 'is_playing', 'mood', 'track']);
      expect(nowPlaying['is_playing']).toBe(false);
      expect(nowPlaying['track']).toBeNull();
      expect(nowPlaying['mood']).toBeNull();
    });

    it('再生中は再生中の曲を返し、played_at は取得時刻になる', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);

      await runGenerate();

      const last = lastPlayed();
      expect((last['track'] as { name: string }).name).toBe('Midnight Drive');
      expect(last['played_at']).toBe(NOW_ISO);
      // 再生中は履歴を取りに行かない（API 呼び出しを増やさない）
      expect(callsTo('/me/player/recently-played')).toHaveLength(0);
    });

    it('前回の観測を引き継いだときは、その観測時刻を played_at にする', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      vi.setSystemTime(new Date(NOW.getTime() + 30 * 60 * 1000));
      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      const last = lastPlayed();
      expect((last['track'] as { name: string }).name).toBe('Midnight Drive');
      expect(last['played_at']).toBe(NOW_ISO);
    });

    it('履歴も前回データも無ければ、すべて null になる', async () => {
      givenNowPlaying(null);
      givenTopTracks([]);

      await runGenerate();

      expect(lastPlayed()).toEqual({ track: null, mood: null, played_at: null });
    });
  });

  describe('停止中でも空にならない（スナップショットの引き継ぎ）', () => {
    it('前回の観測を引き継ぎ、observed_at は更新しない', async () => {
      // 1回目: 再生中
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      const first = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      expect(first['state']).toBe('playing');
      expect(first['observed_at']).toBe(NOW_ISO);

      // 2回目: 30分後、Spotify は停止している
      const later = new Date(NOW.getTime() + 30 * 60 * 1000);
      vi.setSystemTime(later);
      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      const second = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      expect(second['state']).toBe('recent');
      expect((second['track'] as { name: string }).name).toBe('Midnight Drive');
      // ここを更新すると「たった今聴いていた」のまま固まってしまう
      expect(second['observed_at']).toBe(NOW_ISO);
      expect(second['observed_at']).not.toBe(later.toISOString());
    });

    /** 1回目は再生中（NOW に観測）、2回目は later 時点で停止中、という2回の実行。 */
    async function playedThenStopped(
      laterMinutes: number,
      arrange: () => void
    ): Promise<Record<string, unknown>> {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      vi.setSystemTime(new Date(NOW.getTime() + laterMinutes * 60 * 1000));
      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      arrange();
      await runGenerate();
      return JSON.parse(read('snapshot.json')) as Record<string, unknown>;
    }

    const anotherTrack = aSpotifyTrack({
      id: 'track-2',
      name: 'Morning Light',
      external_urls: { spotify: 'https://open.spotify.com/track/track-2' },
    });

    it('前回の観測より後に聴き終えた曲が履歴にあれば、それを「最後に聴いた曲」にする', async () => {
      // 実行が数時間おきでも、その間に聴いた曲を取りこぼさないため
      const playedAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString();
      const snapshot = await playedThenStopped(240, () => givenRecentlyPlayed(anotherTrack, playedAt));

      expect(snapshot['state']).toBe('recent');
      expect((snapshot['track'] as { name: string }).name).toBe('Morning Light');
      // 表示する時刻は聴き終えた時刻
      expect(snapshot['observed_at']).toBe(playedAt);
      expect(read('now-playing.svg')).toContain('Morning Light');
      // 生成時刻を基準にした相対時刻ではなく、日本時間の日時を焼き込む（14:00Z = 23:00 JST）
      expect(read('now-playing.svg')).toContain('LAST PLAYED · 9/21 23:00');
      expect(read('now-playing-light.svg')).toContain('LAST PLAYED · 9/21 23:00');
      expect(read('index.html')).toContain('LAST PLAYED · 9/21 23:00');
    });

    it('履歴が前回の観測より古ければ、前回の観測を引き継ぐ', async () => {
      const playedAt = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
      const snapshot = await playedThenStopped(30, () => givenRecentlyPlayed(anotherTrack, playedAt));

      expect((snapshot['track'] as { name: string }).name).toBe('Midnight Drive');
      expect(snapshot['observed_at']).toBe(NOW_ISO);
    });

    it('履歴を取れない（スコープの無い古い refresh_token）ときは、前回の観測を引き継いで生成を続ける', async () => {
      const snapshot = await playedThenStopped(30, () =>
        respondWith((url) =>
          url.includes('/me/player/recently-played')
            ? new Response('Insufficient client scope', { status: 403 })
            : null
        )
      );

      expect(snapshot['state']).toBe('recent');
      expect((snapshot['track'] as { name: string }).name).toBe('Midnight Drive');
    });

    // snapshot.json は公開ブランチから毎回復元される。ここで落ちると、壊れたまま次の実行も落ち続ける。
    it('observed_at が日時として読めない snapshot.json は捨て、生成を続ける', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();
      const broken = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      writeFileSync(join(outDir, 'snapshot.json'), JSON.stringify({ ...broken, observed_at: 'garbage' }));

      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      const snapshot = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      expect(Number.isNaN(Date.parse(snapshot['observed_at'] as string))).toBe(false);
      expect(read('index.html')).toContain('<!DOCTYPE html>');
    });

    it.each([
      ['track が空のオブジェクト', { track: {} }],
      ['track が文字列', { track: 'x' }],
      ['state が不正', { state: 'paused' }],
      ['mood が不正', { mood: { text: 1 } }],
    ])('%s の snapshot.json は捨て、停止中でも落ちずに作り直す', async (_name, override) => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();
      const broken = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      writeFileSync(join(outDir, 'snapshot.json'), JSON.stringify({ ...broken, ...override }));

      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      const snapshot = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      expect(['playing', 'recent', 'idle']).toContain(snapshot['state']);
      expect(read('index.html')).toContain('<!DOCTYPE html>');
    });

    it('ログに出す曲名から改行と制御文字を取り除き、行頭に :: のワークフローコマンドを作らせない', () => {
      expect(forLog('Song\n::error::injected\r\u0007')).toBe('Song ::error::injected ');
      expect(forLog('普通の曲名')).toBe('普通の曲名');
    });

    it('埋め込みページは、日時として読めない since でも時刻を省いて描ける', () => {
      const html = renderEmbedPage({
        nowPlaying: { is_playing: false, track: null, mood: null, fetched_at: NOW_ISO },
        state: 'recent',
        since: 'garbage',
      });

      expect(html).toContain('LAST PLAYED');
      expect(html).not.toContain('LAST PLAYED ·');
    });

    it('再生中なら履歴は見に行かない', async () => {
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await runGenerate();

      expect(callsTo('/me/player/recently-played')).toHaveLength(0);
    });

    it('履歴の曲が前回と同じなら、ムード文を作り直さない', async () => {
      givenLlmConfigured();
      givenLlmReplies('前回の文');
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000));
      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      moodCache.flushAll();
      givenLlmReplies('作り直された文');
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      givenRecentlyPlayed(aSpotifyTrack(), new Date(NOW.getTime() + 5 * 60 * 1000).toISOString());
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      const snapshot = JSON.parse(read('snapshot.json')) as { mood: { text: string } };
      expect(snapshot.mood.text).toBe('前回の文');
    });

    it('前回と同じ曲を再生中なら、LLM を呼ばずに前回のムード文を使う', async () => {
      givenLlmConfigured();
      givenLlmReplies('前回の文');
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      // 次の実行（新しいプロセスなのでメモリのキャッシュは空）
      vi.setSystemTime(new Date(NOW.getTime() + 30 * 60 * 1000));
      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      moodCache.flushAll();
      givenLlmReplies('作り直された文');
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      const snapshot = JSON.parse(read('snapshot.json')) as { state: string; mood: { text: string } };
      expect(snapshot.state).toBe('playing');
      expect(snapshot.mood.text).toBe('前回の文');
      expect((JSON.parse(read('now-playing.json')) as { mood: { text: string } }).mood.text).toBe('前回の文');
      // ランキングのムード文も顔ぶれが同じなので呼ばない
      expect(callsTo('/chat/completions')).toHaveLength(0);
    });

    it('再生中の曲が前回と違えば、今までどおり生成する', async () => {
      givenLlmConfigured();
      givenLlmReplies('前回の文');
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      moodCache.flushAll();
      givenLlmReplies('別の曲の文');
      givenNowPlaying(aSpotifyTrack({ id: 'track-2', name: 'Another Song' }));
      givenTopTracks([aSpotifyTrack()]);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      expect((JSON.parse(read('snapshot.json')) as { mood: { text: string } }).mood.text).toBe('別の曲の文');
    });

    it('前回 LLM が失敗してムード文が無ければ、同じ曲でも作り直す', async () => {
      // 使い回すと、別の曲を聴くまでムード文が空のまま固まる
      givenLlmConfigured();
      respondWith((url) =>
        url.includes('/chat/completions') ? new Response('busy', { status: 503 }) : null
      );
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });
      expect((JSON.parse(read('snapshot.json')) as { mood: unknown }).mood).toBeNull();

      vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000));
      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenLlmReplies('作り直された文');
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      givenRecentlyPlayed(aSpotifyTrack(), new Date(NOW.getTime() + 5 * 60 * 1000).toISOString());
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      const snapshot = JSON.parse(read('snapshot.json')) as { mood: { text: string } | null };
      expect(snapshot.mood?.text).toBe('作り直された文');
    });

    it('履歴が前回と同じ曲・同じ時刻でも、ムード文が無ければ作り直す', async () => {
      // 実測: 前回の実行で履歴から取った直後に LLM が落ち、次の実行でも
      // 履歴は同じ（新しくない）ため、引き継ぎ側に回って空のまま固まった
      const playedAt = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
      givenLlmConfigured();
      respondWith((url) =>
        url.includes('/chat/completions') ? new Response('busy', { status: 503 }) : null
      );
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      givenRecentlyPlayed(aSpotifyTrack(), playedAt);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });
      expect((JSON.parse(read('snapshot.json')) as { mood: unknown }).mood).toBeNull();

      vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000));
      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenLlmReplies('作り直された文');
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      givenRecentlyPlayed(aSpotifyTrack(), playedAt);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      const snapshot = JSON.parse(read('snapshot.json')) as {
        mood: { text: string } | null;
        observed_at: string;
      };
      expect(snapshot.mood?.text).toBe('作り直された文');
      expect(snapshot.observed_at).toBe(playedAt);
    });

    it('履歴が前回より古い別の曲なら、そのために LLM を呼ばない', async () => {
      givenLlmConfigured();
      givenLlmReplies('前回の文');
      givenNowPlaying(aSpotifyTrack());
      givenTopTracks([aSpotifyTrack()]);
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      vi.setSystemTime(new Date(NOW.getTime() + 30 * 60 * 1000));
      clearHandlers();
      clearCalls();
      installDefaultHandlers();
      givenLlmReplies('呼ばれてはいけない');
      givenNowPlaying(null);
      givenTopTracks([aSpotifyTrack()]);
      givenRecentlyPlayed(anotherTrack, new Date(NOW.getTime() - 60 * 60 * 1000).toISOString());
      await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: false });

      // ランキングの顔ぶれは変わっていないので、ここも呼ばれない
      expect(callsTo('/chat/completions')).toHaveLength(0);
    });

    it('引き継げる前回データも無ければ idle として生成する', async () => {
      givenNowPlaying(null);
      givenTopTracks([]);

      await runGenerate();

      const snapshot = JSON.parse(read('snapshot.json')) as Record<string, unknown>;
      expect(snapshot['state']).toBe('idle');
      expect(snapshot['track']).toBeNull();
      expectValidXml(read('now-playing.svg'));
    });
  });

  describe('ワークフロー定義 (.github/workflows/update-spotify.yml)', () => {
    interface Step {
      name?: string;
      run?: string;
      env?: Record<string, string>;
    }
    interface Workflow {
      on: { schedule?: { cron: string }[] };
      concurrency: { 'cancel-in-progress': boolean };
      permissions: Record<string, string>;
      jobs: Record<string, { steps: Step[]; permissions?: Record<string, string>; 'timeout-minutes'?: number }>;
    }

    const workflow = yaml.load(
      readFileSync(new URL('../../.github/workflows/update-spotify.yml', import.meta.url), 'utf8')
    ) as Workflow;
    const steps = must(workflow.jobs['update'], 'ジョブ update').steps;
    const allRunScripts = steps.map((step) => step.run ?? '').join('\n');

    it('snapshot.json の形をワークフローに持ち込まない（作り直しは generate のオプションで頼む）', () => {
      expect(allRunScripts).not.toContain('node -e');
      expect(allRunScripts).not.toContain('ranking_mood');
      expect(allRunScripts).toContain('--refresh-ranking-mood');
    });

    it('定期実行の期間と件数は、リポジトリの Variables で変えられる（手動実行の入力 > Variables > 既定値）', () => {
      const env = must(steps.find((step) => step.name === 'Generate'), 'Generate ステップ').env ?? {};

      expect(env['RANGE']).toBe("${{ inputs.range || vars.RANKING_RANGE || 'short_term' }}");
      expect(env['COUNT']).toBe("${{ inputs.count || vars.RANKING_COUNT || '5' }}");
    });

    it('定期実行のスケジュールが設定されている', () => {
      // 間隔そのものは仕様ではない（GitHub 側で遅延・間引きされるため、
      // 30分という数字に意味を持たせていない）。定期実行の口があることを見る。
      expect(workflow.on.schedule?.length).toBeGreaterThan(0);
      expect(workflow.on.schedule![0]!.cron).toMatch(/^\S+( \S+){4}$/);
    });

    it('ランキング画像を生成するステップがある', () => {
      expect(allRunScripts).toContain('generate');
      expect(allRunScripts).toContain('--range');
      expect(allRunScripts).toContain('--count');
      expect(allRunScripts).toContain('--theme');
    });

    it('生成ステップに Spotify の資格情報が渡っている', () => {
      const env = steps.find((step) => (step.run ?? '').includes('generate'))?.env ?? {};
      for (const name of [
        'SPOTIFY_CLIENT_ID',
        'SPOTIFY_CLIENT_SECRET',
        'SPOTIFY_REFRESH_TOKEN',
      ]) {
        expect(env).toHaveProperty(name);
      }
    });

    it('公開ブランチから前回の snapshot.json を復元するステップがある', () => {
      // これが無いと、停止中の引き継ぎが毎回リセットされる
      expect(allRunScripts).toContain('snapshot.json');
    });

    it('公開ブランチへ push する', () => {
      expect(allRunScripts).toContain('spotify-data');
      expect(allRunScripts).toMatch(/git [\s\S]*\bpush -q --force /);
      // 書き込み権限は push するジョブにだけ渡し、ワークフロー全体は読み取りのまま
      expect(must(workflow.jobs['update'], 'ジョブ update').permissions?.['contents']).toBe('write');
      expect(workflow.permissions['contents']).toBe('read');
    });

    it('push の URL・コマンドラインにトークンを埋め込まない（クレデンシャルヘルパーで渡す）', () => {
      const publish = steps.find((step) => step.name === 'Publish to spotify-data branch')!.run ?? '';

      expect(publish).not.toMatch(/x-access-token:\$\{?GITHUB_TOKEN/);
      expect(publish).not.toMatch(/https:\/\/[^"\s]*@github\.com/);
      expect(publish).toContain('credential.helper=');
    });

    it('止まったジョブが後続の更新を何時間も塞がないよう、timeout-minutes を付ける', () => {
      expect(must(workflow.jobs['update'], 'ジョブ update')['timeout-minutes']).toBeGreaterThan(0);
      expect(must(workflow.jobs['update'], 'ジョブ update')['timeout-minutes']).toBeLessThanOrEqual(10);
    });

    it('実行中のジョブを途中で中断しない', () => {
      // push の途中で殺されると公開ブランチに中途半端な状態が残る
      expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    });
  });
});

describe('静的モードとライブAPIは同一のJSONスキーマを出す', () => {
  // 利用者が fetch 先のURLを差し替えるだけで静的↔ライブを行き来できる、
  // というのがこの製品の中核。崩すと静かに互換性が失われる。
  // ライブAPIが扱うのは now-playing だけ。ランキングは静的モード専用だが、
  // 取得層（collectTopTracks）の出力をそのまま書き出す点は同じ。
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'spotify-embedded-spec-schema-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('out/*.json は collect*() の戻り値と一致する', async () => {
    givenNowPlaying(aSpotifyTrack());
    givenTopTracks([aSpotifyTrack(), aSpotifyTrack({ id: 'track-2', name: 'Second' })]);

    await generate({
      outDir,
      count: 5,
      range: 'medium_term',
      limit: 30,
      theme: 'dark',
      skipMood: true,
    });

    const liveNowPlaying = await collectNowPlaying({ bypassCache: true, skipMood: true });
    const liveTopTracks = await collectTopTracks({ range: 'medium_term', limit: 30 });

    expect(JSON.parse(readFileSync(join(outDir, 'now-playing.json'), 'utf8'))).toEqual(
      liveNowPlaying
    );
    expect(JSON.parse(readFileSync(join(outDir, 'top-tracks.json'), 'utf8'))).toEqual(
      liveTopTracks
    );
  });

  it('YAML も同じ内容を表す', async () => {
    givenNowPlaying(aSpotifyTrack());
    givenTopTracks([aSpotifyTrack()]);

    await generate({
      outDir,
      count: 5,
      range: 'short_term',
      limit: 50,
      theme: 'dark',
      skipMood: true,
    });

    const asJson = JSON.parse(readFileSync(join(outDir, 'top-tracks.json'), 'utf8')) as unknown;
    const asYaml = yaml.load(readFileSync(join(outDir, 'top-tracks.yaml'), 'utf8'));

    expect(asYaml).toEqual(asJson);
  });
});

describe('公開スキーマの JSON Schema（schema/*.schema.json）', () => {
  let outDir: string;
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  const validatorOf = (name: string) =>
    ajv.compile(JSON.parse(readFileSync(new URL(`../../schema/${name}.schema.json`, import.meta.url), 'utf8')) as object);
  const validators = {
    'now-playing': validatorOf('now-playing'),
    'top-tracks': validatorOf('top-tracks'),
    'last-played': validatorOf('last-played'),
  };

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'spotify-embedded-schema-'));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  function expectValid(name: keyof typeof validators, data: unknown): void {
    const validate = validators[name];
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  }

  it.each([
    ['再生中・ムード文あり', true, true],
    ['再生中・ムード文なし', true, false],
    ['停止中（曲なし）', false, false],
  ])('静的モードの出力（%s）は、JSON も YAML もスキーマに合う', async (_label, playing, withMood) => {
    if (withMood) {
      givenLlmConfigured();
      givenLlmReplies('今チルな気分になっています');
    }
    givenNowPlaying(playing ? aSpotifyTrack() : null);
    givenTopTracks([aSpotifyTrack(), aSpotifyTrack({ id: 'track-2', popularity: 55, preview_url: 'https://p.scdn.co/x' })]);

    await generate({ outDir, count: 5, range: 'short_term', limit: 50, theme: 'dark', skipMood: !withMood });

    for (const name of ['now-playing', 'top-tracks', 'last-played'] as const) {
      expectValid(name, JSON.parse(readFileSync(join(outDir, `${name}.json`), 'utf8')));
      expectValid(name, yaml.load(readFileSync(join(outDir, `${name}.yaml`), 'utf8')));
    }
  });

  it('ライブAPIの /api/now-playing の応答も同じスキーマに合う', async () => {
    const { createApp } = await import('../app.js');
    givenNowPlaying(aSpotifyTrack());

    expectValid('now-playing', await (await createApp().request('/api/now-playing')).json());
  });

  it('スキーマに無いキーや、型の違う値は弾く（スキーマが何でも通すものになっていない）', () => {
    const valid = { is_playing: false, track: null, mood: null, fetched_at: NOW_ISO };

    expect(validators['now-playing'](valid)).toBe(true);
    expect(validators['now-playing']({ ...valid, extra: 1 })).toBe(false);
    expect(validators['now-playing']({ ...valid, is_playing: 'yes' })).toBe(false);
    expect(validators['now-playing']({ ...valid, track: { id: 't' } })).toBe(false);
  });
});
