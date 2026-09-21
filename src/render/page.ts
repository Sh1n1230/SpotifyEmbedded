/**
 * iframe 埋め込み用のHTMLページ。
 *
 * SVGでは表現できないもの（Spotifyへのリンク、ホバー、ライブ更新）を
 * 担当する。ポートフォリオサイトに貼るのが主用途。
 *
 * 静的モード（CLI生成）では liveEndpoint を指定せず、生成時点のデータを
 * そのまま焼き込む。ライブAPIモードでは liveEndpoint を指定すると、
 * ページ側が定期的に取得し直す。
 */
import {
  DEFAULT_RANKING_COUNT,
  DEFAULT_TOP_TRACKS_RANGE,
  MAX_RANKING_COUNT,
  type NowPlayingResponse,
  type TopTracksResponse,
} from '../types/index.js';
import { rangeLabelEn } from '../core/topTracksParams.js';
import { THEMES, FONT_STACK, relativeTimeJa, formatDateJa, type ThemeName } from './theme.js';
import { escapeXml } from './text.js';
import { albumArtAtSize } from './image.js';
import type { PlaybackState } from './card.js';

export interface PageInput {
  nowPlaying: NowPlayingResponse;
  topTracks?: TopTracksResponse | null | undefined;
  state: PlaybackState;
  /** state が 'recent' のときの、その曲を確認した時刻 */
  since?: string | undefined;
  theme?: ThemeName | undefined;
  /** 背景を透過する。ホスト側の背景に馴染ませたい場合に使う。 */
  transparent?: boolean | undefined;
  /** 指定すると、このURLを定期的に取得してカードを更新する。 */
  liveEndpoint?: string | undefined;
  /** ライブ更新の間隔（秒）。既定30秒。 */
  refreshSeconds?: number | undefined;
  /** ランキングの表示件数。1〜50、既定5。 */
  rankingCount?: number | undefined;
}

export function renderEmbedPage(input: PageInput): string {
  const themeName: ThemeName = input.theme ?? 'dark';
  const theme = THEMES[themeName];
  const { nowPlaying, topTracks, state } = input;
  const track = nowPlaying.track;
  const mood = nowPlaying.mood;

  const label = state === 'playing'
    ? 'NOW PLAYING'
    : state === 'recent'
      ? `LAST PLAYED${input.since ? ` · ${relativeTimeJa(new Date(input.since))}` : ''}`
      : 'NOTHING PLAYING';

  const rankingSection = topTracks && topTracks.tracks.length > 0
    ? renderRanking(topTracks, input.rankingCount)
    : '';

  return `<!DOCTYPE html>
<html lang="ja" data-state="${escapeXml(state)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${themeName}">
<title>${escapeXml(buildTitle(state, track?.name, track?.artist))}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: ${input.transparent ? 'transparent' : theme.bg};
    --surface: ${theme.surface};
    --fg: ${theme.fg};
    --sub: ${theme.sub};
    --muted: ${theme.muted};
    --accent: ${theme.accent};
    --border: ${theme.border};
    --placeholder: ${theme.placeholder};
  }

  body {
    font-family: ${FONT_STACK};
    background: var(--bg);
    color: var(--fg);
    padding: 16px;
    -webkit-font-smoothing: antialiased;
  }

  .card {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    max-width: 460px;
    text-decoration: none;
    color: inherit;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: ${input.transparent ? 'transparent' : 'var(--bg)'};
    transition: border-color 0.18s ease, transform 0.18s ease;
  }

  a.card:hover { border-color: var(--accent); transform: translateY(-1px); }
  a.card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .art, .art-placeholder {
    width: 112px;
    height: 112px;
    flex: none;
    border-radius: 8px;
    object-fit: cover;
    background: var(--placeholder);
  }

  .art-placeholder {
    display: grid;
    place-items: center;
    font-size: 12px;
    color: var(--muted);
  }

  .body { min-width: 0; padding-top: 2px; }

  .label {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--muted);
    margin-bottom: 10px;
  }

  /* 再生中かどうかは #label の data-playing で表す。
     ライブ更新のスクリプトが属性を付け外しするだけで済むようにしている。 */
  .label[data-playing] { color: var(--accent); }

  /* 再生中インジケータ */
  .eq { display: none; align-items: flex-end; gap: 2px; height: 12px; }
  .label[data-playing] .eq { display: flex; }
  .eq span {
    width: 3px;
    border-radius: 1.5px;
    background: var(--accent);
    animation: eq 0.9s ease-in-out infinite;
  }
  .eq span:nth-child(2) { animation-duration: 1.25s; }
  .eq span:nth-child(3) { animation-duration: 0.75s; }
  @keyframes eq { 0%, 100% { height: 4px; } 50% { height: 12px; } }

  @media (prefers-reduced-motion: reduce) {
    .eq span { animation: none; height: 8px; }
    a.card:hover { transform: none; }
  }

  /* ムード文が主役。曲名はその出典として下に置く。 */
  .mood {
    font-size: 19px;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: 0.01em;
    overflow-wrap: anywhere;
  }

  .track { font-size: 12.5px; color: var(--sub); margin-top: 10px; }
  .artist { font-size: 11.5px; color: var(--muted); margin-top: 3px; }
  .track, .artist { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ムードが無い場合は曲名を主役サイズに昇格させる */
  .card[data-no-mood] .track { font-size: 17px; font-weight: 700; color: var(--fg); margin-top: 0; white-space: normal; }

  .idle { font-size: 17px; font-weight: 700; color: var(--muted); }

  .ranking { max-width: 460px; margin-top: 14px; padding: 14px; border: 1px solid var(--border); border-radius: 12px; }
  .ranking-head { padding-bottom: 10px; border-bottom: 1px solid var(--border); }
  .ranking-head-row { display: flex; justify-content: space-between; align-items: baseline; }
  .ranking-mood { font-size: 15px; font-weight: 700; line-height: 1.4; margin-top: 8px; overflow-wrap: anywhere; }
  .ranking-title { font-size: 10px; font-weight: 600; letter-spacing: 0.14em; color: var(--accent); }
  .ranking-date { font-size: 10px; color: var(--muted); }
  .ranking ol { list-style: none; }
  .ranking li { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
  .ranking li + li { border-top: 1px solid var(--border); }
  .rank { font-size: 13px; font-weight: 700; color: var(--muted); width: 16px; text-align: right; flex: none; }
  .ranking img { width: 40px; height: 40px; border-radius: 5px; flex: none; background: var(--placeholder); }
  .ranking .meta { min-width: 0; }
  .ranking .name { font-size: 13px; font-weight: 600; }
  .ranking .by { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .ranking .name, .ranking .by { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ranking a { color: inherit; text-decoration: none; }
  .ranking a:hover .name { color: var(--accent); }
</style>
</head>
<body>
${renderCardMarkup(track, mood, state, label)}
${rankingSection}
${input.liveEndpoint ? renderLiveScript(input.liveEndpoint, input.refreshSeconds ?? 30, track !== null) : ''}
</body>
</html>
`;
}

function renderCardMarkup(
  track: NowPlayingResponse['track'],
  mood: NowPlayingResponse['mood'],
  state: PlaybackState,
  label: string
): string {
  // イコライザは常に描き、表示・非表示は #label の data-playing に任せる。
  // ライブ更新で再生が始まった/止まったときにDOMを作り直さずに済む。
  const eq = '<span class="eq"><span></span><span></span><span></span></span>';
  const playing = state === 'playing' ? ' data-playing' : '';

  if (!track) {
    return `<div class="card" id="card">
  <div class="art-placeholder">no art</div>
  <div class="body">
    <div class="label" id="label"${playing}>${eq}<span id="label-text">${escapeXml(label)}</span></div>
    <p class="idle" id="mood">再生していません</p>
  </div>
</div>`;
  }

  // ジャケ写は装飾。曲名はテキストとして隣にあるので alt は空にし、
  // 読み上げはリンク全体の aria-label に任せる（画像が落ちても崩れない）。
  // 112pxで表示するので300px版を使う。640px版だと表示が目に見えて遅れる。
  const art = track.album_art_url
    ? `<img class="art" id="art" src="${escapeXml(albumArtAtSize(track.album_art_url, 300))}" alt="" decoding="async">`
    : '<div class="art-placeholder" id="art">no art</div>';

  const ariaLabel = `${state === 'playing' ? '再生中' : '最後に再生'}: ${mood?.text ? `${mood.text} — ` : ''}${track.name} / ${track.artist}（Spotifyで開く）`;

  return `<a class="card" id="card"${mood?.text ? '' : ' data-no-mood'} href="${escapeXml(track.spotify_url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeXml(ariaLabel)}">
  ${art}
  <div class="body">
    <div class="label" id="label"${playing}>${eq}<span id="label-text">${escapeXml(label)}</span></div>
    ${mood?.text ? `<p class="mood" id="mood">${escapeXml(mood.text)}</p>` : ''}
    <p class="track" id="track">${escapeXml(track.name)}</p>
    <p class="artist" id="artist">${escapeXml(track.artist)}</p>
  </div>
</a>`;
}

function renderRanking(topTracks: TopTracksResponse, rankingCount?: number | undefined): string {
  const fetchedAt = new Date(topTracks.fetched_at);
  const dateLabel = Number.isNaN(fetchedAt.getTime()) ? '' : `${formatDateJa(fetchedAt)} 時点`;
  const count = Math.min(Math.max(rankingCount ?? DEFAULT_RANKING_COUNT, 1), MAX_RANKING_COUNT);
  const rangeLabel = rangeLabelEn(topTracks.range ?? DEFAULT_TOP_TRACKS_RANGE);

  const items = topTracks.tracks
    .slice(0, count)
    .map(
      (track) => `    <li>
      <span class="rank">${track.rank}</span>
      <a href="${escapeXml(track.spotify_url)}" target="_blank" rel="noopener noreferrer" style="display:flex;gap:12px;align-items:center;min-width:0">
        <img src="${escapeXml(albumArtAtSize(track.album_art_url, 64))}" alt="" decoding="async">
        <span class="meta">
          <span class="name" style="display:block">${escapeXml(track.name)}</span>
          <span class="by" style="display:block">${escapeXml(track.artist)}</span>
        </span>
      </a>
    </li>`
    )
    .join('\n');

  return `<section class="ranking">
  <div class="ranking-head">
    <div class="ranking-head-row">
      <span class="ranking-title">TOP TRACKS · ${escapeXml(rangeLabel)}</span>
      <span class="ranking-date">${escapeXml(dateLabel)}</span>
    </div>${topTracks.mood?.text ? `\n    <p class="ranking-mood">${escapeXml(topTracks.mood.text)}</p>` : ''}
  </div>
  <ol>
${items}
  </ol>
</section>`;
}

/**
 * ライブ更新。DOMへの反映は textContent と setAttribute のみで行い、
 * APIレスポンス由来の文字列をHTMLとして解釈させない。
 */
function renderLiveScript(
  endpoint: string,
  refreshSeconds: number,
  hasTrack: boolean
): string {
  const interval = Math.max(refreshSeconds, 10) * 1000;

  return `<script>
(function () {
  var endpoint = ${JSON.stringify(endpoint)};
  var interval = ${interval};

  // カードの骨組み（<a>＋<img> か、曲なしの <div>）はサーバー側で決まる。
  // 曲の有無が入れ替わったときだけはDOMを組み直せないので読み込み直す。
  var hadTrack = ${hasTrack ? 'true' : 'false'};

  // ジャケ写URLのプレフィックスは画像サイズを表す。112pxで描くので
  // 300px版に寄せる。640px版のままだと表示が目に見えて遅れる。
  var ART_SIZES = ['ab67616d0000b273', 'ab67616d00001e02', 'ab67616d00004851'];

  function artAt300(url) {
    for (var i = 0; i < ART_SIZES.length; i++) {
      if (url.indexOf(ART_SIZES[i]) !== -1) return url.replace(ART_SIZES[i], ART_SIZES[1]);
    }
    return url;
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function update(data) {
    var card = document.getElementById('card');
    if (!card) return;

    var track = data && data.track;
    if (!!track !== hadTrack) {
      location.reload();
      return;
    }
    if (!track) return;

    var playing = !!data.is_playing;
    setText('label-text', playing ? 'NOW PLAYING' : 'LAST PLAYED');

    // 再生が止まったらイコライザとアクセント色も戻す（CSSが属性を見ている）
    var label = document.getElementById('label');
    if (label) {
      if (playing) label.setAttribute('data-playing', '');
      else label.removeAttribute('data-playing');
    }

    setText('track', track.name);
    setText('artist', track.artist);
    if (data.mood && data.mood.text) setText('mood', data.mood.text);

    var art = document.getElementById('art');
    if (art && art.tagName === 'IMG' && track.album_art_url) {
      art.setAttribute('src', artAt300(track.album_art_url));
    }
    if (card.tagName === 'A' && track.spotify_url) card.setAttribute('href', track.spotify_url);
  }

  function tick() {
    fetch(endpoint, { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data) update(data); })
      .catch(function () { /* 一時的な失敗は次回に任せる */ });
  }

  setInterval(tick, interval);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tick();
  });
})();
</script>`;
}

function buildTitle(state: PlaybackState, name?: string, artist?: string): string {
  if (!name) return '再生していません';
  const prefix = state === 'playing' ? 'Now Playing' : 'Last Played';
  return `${prefix}: ${name} / ${artist ?? ''}`;
}
