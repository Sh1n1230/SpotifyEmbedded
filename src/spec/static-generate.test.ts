/** 静的モード（generate）の成果物と、ライブAPIとのスキーマの一致（要件3・4）。方針は ./support.ts の冒頭を参照。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { XMLValidator } from 'fast-xml-parser';
import yaml from 'js-yaml';

import { moodCache } from '../cache/index.js';
import { collectNowPlaying, collectTopTracks } from '../core/collect.js';
import { generate } from '../cli/generate.js';
import { renderRankingCard } from '../render/ranking.js';
import { renderEmbedPage } from '../render/page.js';
import type { TopTrackEntry } from '../types/index.js';
import { NOW, NOW_ISO, respondWith, callsTo, installDefaultHandlers, clearHandlers, clearCalls, aSpotifyTrack, aTopTrackEntry, givenNowPlaying, givenRecentlyPlayed, givenTopTracks, givenLlmConfigured, givenLlmReplies } from './support.js';

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

    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Midnight Drive');
  });

  it('曲名やアーティスト名にXMLの特殊文字が入っても壊れない', () => {
    // ここが壊れると GitHub 上で画像が「表示されない」形で失敗する。
    // テキストノードだけでなく aria-label などの属性値にも差し込まれるため、
    // 正規表現ではなく実際にパースして確かめる。
    const nasty = 'Rock & Roll <script>alert("x")</script> \'quoted\'';
    const svg = render([aTopTrackEntry({ name: nasty, artist: nasty, album: nasty })]);

    expect(XMLValidator.validate(svg)).toBe(true);
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

    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain('データがありません');
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

    expect(XMLValidator.validate(light)).toBe(true);
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
        expect(XMLValidator.validate(read(name))).toBe(true);
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
      expect(XMLValidator.validate(read('now-playing.svg'))).toBe(true);
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
      jobs: Record<string, { steps: Step[]; permissions?: Record<string, string> }>;
    }

    const workflow = yaml.load(
      readFileSync(new URL('../../.github/workflows/update-spotify.yml', import.meta.url), 'utf8')
    ) as Workflow;
    const steps = workflow.jobs['update'].steps;
    const allRunScripts = steps.map((step) => step.run ?? '').join('\n');

    it('定期実行のスケジュールが設定されている', () => {
      // 間隔そのものは仕様ではない（GitHub 側で遅延・間引きされるため、
      // 30分という数字に意味を持たせていない）。定期実行の口があることを見る。
      expect(workflow.on.schedule?.length).toBeGreaterThan(0);
      expect(workflow.on.schedule![0].cron).toMatch(/^\S+( \S+){4}$/);
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
      expect(allRunScripts).toContain('git push');
      // 書き込み権限は push するジョブにだけ渡し、ワークフロー全体は読み取りのまま
      expect(workflow.jobs['update'].permissions?.['contents']).toBe('write');
      expect(workflow.permissions['contents']).toBe('read');
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
