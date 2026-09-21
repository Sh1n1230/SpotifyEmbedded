/**
 * SpotifyEmbedded ワンタグ埋め込み。
 *
 *   <script src="https://your-api.example.com/embed.js"
 *           data-target="#spotify"
 *           data-theme="dark"
 *           data-ranking="false"
 *           data-range="short_term"
 *           data-count="5"></script>
 *
 * カードは Shadow DOM の中に作るので、貼り付け先サイトのCSSから
 * 影響を受けない（逆にこちらのCSSも漏れない）。
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var base = script.src.replace(/\/embed\.js(?:\?.*)?$/, '');

  // Spotify が用意する集計期間は3つだけ。見出しの文言もここで持つ。
  var RANGE_LABELS = {
    short_term: '4 WEEKS',
    medium_term: '6 MONTHS',
    long_term: '1 YEAR'
  };
  var LIMITS = [10, 30, 50];

  function pickRange(value) {
    return RANGE_LABELS[value] ? value : 'short_term';
  }

  function pickLimit(value) {
    var n = parseInt(value, 10);
    return LIMITS.indexOf(n) >= 0 ? n : 50;
  }

  function pickCount(value) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return 5;
    return Math.min(Math.max(n, 1), 50);
  }

  var options = {
    target: script.getAttribute('data-target'),
    theme: script.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
    ranking: script.getAttribute('data-ranking') === 'true',
    range: pickRange(script.getAttribute('data-range')),
    limit: pickLimit(script.getAttribute('data-limit')),
    count: pickCount(script.getAttribute('data-count')),
    transparent: script.getAttribute('data-transparent') === 'true',
    refresh: Math.max(parseInt(script.getAttribute('data-refresh') || '30', 10) || 30, 10)
  };

  var THEMES = {
    dark: {
      bg: '#0e1013', fg: '#f2f4f7', sub: '#c7cdd6', muted: '#8b95a1',
      accent: '#1db954', border: '#232931', placeholder: '#1e242b'
    },
    light: {
      bg: '#ffffff', fg: '#11151a', sub: '#39424d', muted: '#6b7681',
      accent: '#1aa34a', border: '#e4e8ed', placeholder: '#eceff3'
    }
  };

  var theme = THEMES[options.theme];

  var host = document.createElement('div');
  host.className = 'spotify-embedded';
  var mount = options.target ? document.querySelector(options.target) : null;
  if (mount) mount.appendChild(host);
  else if (script.parentNode) script.parentNode.insertBefore(host, script.nextSibling);
  else return;

  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var style = document.createElement('style');
  style.textContent = [
    ':host, * { box-sizing: border-box; }',
    '.card {',
    '  display: flex; gap: 16px; align-items: flex-start; max-width: 460px;',
    '  padding: 14px; border: 1px solid ' + theme.border + '; border-radius: 12px;',
    '  background: ' + (options.transparent ? 'transparent' : theme.bg) + ';',
    '  color: ' + theme.fg + '; text-decoration: none;',
    "  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', 'Segoe UI', sans-serif;",
    '  transition: border-color .18s ease, transform .18s ease;',
    '}',
    'a.card:hover { border-color: ' + theme.accent + '; transform: translateY(-1px); }',
    '.art, .art-ph { width: 112px; height: 112px; flex: none; border-radius: 8px; object-fit: cover; background: ' + theme.placeholder + '; }',
    '.art-ph { display: grid; place-items: center; font-size: 12px; color: ' + theme.muted + '; }',
    '.body { min-width: 0; padding-top: 2px; }',
    '.label { display: flex; align-items: center; gap: 7px; font-size: 10px; font-weight: 600; letter-spacing: .14em; color: ' + theme.muted + '; margin-bottom: 10px; }',
    '.label.live { color: ' + theme.accent + '; }',
    '.eq { display: flex; align-items: flex-end; gap: 2px; height: 12px; }',
    '.eq i { width: 3px; height: 4px; border-radius: 1.5px; background: ' + theme.accent + '; animation: eq .9s ease-in-out infinite; }',
    '.eq i:nth-child(2) { animation-duration: 1.25s; }',
    '.eq i:nth-child(3) { animation-duration: .75s; }',
    '@keyframes eq { 0%, 100% { height: 4px; } 50% { height: 12px; } }',
    /* ムード文が主役。曲名はその出典として下に添える。 */
    '.mood { font-size: 19px; font-weight: 700; line-height: 1.35; margin: 0; overflow-wrap: anywhere; }',
    '.track { font-size: 12.5px; color: ' + theme.sub + '; margin: 10px 0 0; }',
    '.artist { font-size: 11.5px; color: ' + theme.muted + '; margin: 3px 0 0; }',
    '.track, .artist { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.card.no-mood .track { font-size: 17px; font-weight: 700; color: ' + theme.fg + '; margin-top: 0; white-space: normal; }',
    '.idle { font-size: 17px; font-weight: 700; color: ' + theme.muted + '; margin: 0; }',
    '.ranking { max-width: 460px; margin-top: 14px; padding: 14px; border: 1px solid ' + theme.border + '; border-radius: 12px;',
    "  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', sans-serif; }",
    '.ranking h3 { font-size: 10px; font-weight: 600; letter-spacing: .14em; color: ' + theme.accent + '; margin: 0 0 10px; }',
    '.ranking .ranking-mood { font-size: 15px; font-weight: 700; line-height: 1.4; color: ' + theme.fg + '; margin: -2px 0 10px; overflow-wrap: anywhere; }',
    '.ranking ol { list-style: none; margin: 0; padding: 0; }',
    '.ranking li { display: flex; align-items: center; gap: 12px; padding: 8px 0; }',
    '.ranking li + li { border-top: 1px solid ' + theme.border + '; }',
    '.ranking .rank { font-size: 13px; font-weight: 700; color: ' + theme.muted + '; width: 16px; text-align: right; flex: none; }',
    '.ranking img { width: 40px; height: 40px; border-radius: 5px; flex: none; background: ' + theme.placeholder + '; }',
    '.ranking .meta { min-width: 0; }',
    '.ranking .name { font-size: 13px; font-weight: 600; color: ' + theme.fg + '; }',
    '.ranking .by { font-size: 11px; color: ' + theme.muted + '; margin-top: 2px; }',
    '.ranking .name, .ranking .by { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '@media (prefers-reduced-motion: reduce) { .eq i { animation: none; height: 8px; } a.card:hover { transform: none; } }'
  ].join('\n');
  root.appendChild(style);

  var container = document.createElement('div');
  root.appendChild(container);

  // Spotifyのジャケ写URLはプレフィックスがサイズを表す。表示サイズに
  // 合ったものを選ばないと、640px画像を40pxで描くことになり表示が遅れる。
  var ART_SIZES = { 640: 'ab67616d0000b273', 300: 'ab67616d00001e02', 64: 'ab67616d00004851' };

  function artAtSize(url, size) {
    if (!url) return url;
    var target = ART_SIZES[size];
    if (!target) return url;
    for (var key in ART_SIZES) {
      var prefix = ART_SIZES[key];
      if (url.indexOf(prefix) !== -1) return url.replace(prefix, target);
    }
    return url;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    // API由来の文字列は必ず textContent で入れる（HTMLとして解釈させない）
    if (text != null) node.textContent = text;
    return node;
  }

  function renderCard(data) {
    var track = data && data.track;
    var mood = data && data.mood;
    var playing = !!(data && data.is_playing && track);

    var card = document.createElement(track ? 'a' : 'div');
    card.className = 'card' + (track && !(mood && mood.text) ? ' no-mood' : '');
    if (track) {
      card.href = track.spotify_url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.setAttribute(
        'aria-label',
        (playing ? '再生中: ' : '最後に再生: ') +
          (mood && mood.text ? mood.text + ' — ' : '') +
          track.name + ' / ' + track.artist + '（Spotifyで開く）'
      );
    }

    if (track && track.album_art_url) {
      // ジャケ写は装飾。読み上げはリンク全体の aria-label に任せる。
      var img = el('img', 'art');
      img.src = artAtSize(track.album_art_url, 300);
      img.alt = '';
      img.decoding = 'async';
      card.appendChild(img);
    } else {
      card.appendChild(el('div', 'art-ph', 'no art'));
    }

    var body = el('div', 'body');

    var label = el('div', 'label' + (playing ? ' live' : ''));
    if (playing) {
      var eq = el('span', 'eq');
      eq.appendChild(el('i'));
      eq.appendChild(el('i'));
      eq.appendChild(el('i'));
      label.appendChild(eq);
    }
    label.appendChild(el('span', null, track ? (playing ? 'NOW PLAYING' : 'LAST PLAYED') : 'NOTHING PLAYING'));
    body.appendChild(label);

    if (!track) {
      body.appendChild(el('p', 'idle', '再生していません'));
    } else {
      if (mood && mood.text) body.appendChild(el('p', 'mood', mood.text));
      body.appendChild(el('p', 'track', track.name));
      body.appendChild(el('p', 'artist', track.artist));
    }

    card.appendChild(body);
    return card;
  }

  function renderRanking(data) {
    if (!data || !data.tracks || !data.tracks.length) return null;

    var section = el('section', 'ranking');
    var label = RANGE_LABELS[data.range] || RANGE_LABELS.short_term;
    section.appendChild(el('h3', null, 'TOP TRACKS · ' + label));
    if (data.mood && data.mood.text) section.appendChild(el('p', 'ranking-mood', data.mood.text));

    var list = el('ol');
    data.tracks.slice(0, options.count).forEach(function (track) {
      var item = el('li');
      item.appendChild(el('span', 'rank', String(track.rank)));

      var link = el('a');
      link.href = track.spotify_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.cssText = 'display:flex;gap:12px;align-items:center;min-width:0;text-decoration:none;color:inherit';

      var img = el('img');
      img.src = artAtSize(track.album_art_url, 64);
      img.alt = '';
      img.decoding = 'async';
      link.appendChild(img);

      var meta = el('div', 'meta');
      meta.appendChild(el('div', 'name', track.name));
      meta.appendChild(el('div', 'by', track.artist));
      link.appendChild(meta);

      item.appendChild(link);
      list.appendChild(item);
    });

    section.appendChild(list);
    return section;
  }

  function get(path) {
    return fetch(base + path, { headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('request failed: ' + res.status);
      return res.json();
    });
  }

  var rankingNode = null;

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function refresh() {
    return get('/api/now-playing')
      .then(function (data) {
        clear(container);
        container.appendChild(renderCard(data));
        if (rankingNode) container.appendChild(rankingNode);
      })
      .catch(function () {
        /* 一時的な失敗は次の更新に任せる */
      });
  }

  refresh().then(function () {
    if (!options.ranking) return;
    var query = '?range=' + options.range + '&limit=' + options.limit;
    return get('/api/top-tracks' + query).then(function (data) {
      rankingNode = renderRanking(data);
      if (rankingNode) container.appendChild(rankingNode);
    }).catch(function () {});
  });

  setInterval(refresh, options.refresh * 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
})();
