/**
 * SpotifyEmbedded ワンタグ埋め込み。
 *
 *   <script src="https://your-api.example.com/embed.js"
 *           data-target="#spotify"
 *           data-theme="dark"></script>
 *
 * カードは Shadow DOM の中に作るので、貼り付け先サイトのCSSから
 * 影響を受けない（逆にこちらのCSSも漏れない）。
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var base = script.src.replace(/\/embed\.js(?:\?.*)?$/, '');

  var options = {
    target: script.getAttribute('data-target'),
    theme: script.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
    transparent: script.getAttribute('data-transparent') === 'true',
    // /embed の ?refresh= と同じく 10〜3600 秒。setInterval は約24.8日を超えると 0 扱いになる
    refresh: Math.min(Math.max(parseInt(script.getAttribute('data-refresh') || '30', 10) || 30, 10), 3600)
  };

  var THEMES = {
    dark: {
      bg: '#0e1013', fg: '#f2f4f7', sub: '#c7cdd6', muted: '#8b95a1',
      accent: '#1db954', border: '#232931', placeholder: '#1e242b'
    },
    light: {
      bg: '#ffffff', fg: '#11151a', sub: '#39424d', muted: '#6b7681',
      accent: '#15803d', border: '#e4e8ed', placeholder: '#eceff3'
    }
  };

  var theme = THEMES[options.theme];

  // src/render/theme.ts の FONT_STACK と同じ（一致は spec で確かめている）
  var FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Noto Sans JP', 'Segoe UI', 'Yu Gothic UI', sans-serif";

  var host = document.createElement('div');
  host.className = 'spotify-embedded';
  var mount = null;
  if (options.target) {
    // 不正なセレクタ（"#" や数字で始まる ID など）は querySelector が SyntaxError を投げる。
    // 一致する要素が無いときと同じく、スクリプトの直後に描く。
    try {
      mount = document.querySelector(options.target);
      // eslint-disable-next-line no-unused-vars -- ES5 では catch の束縛を省けない
    } catch (err) {
      if (window.console) console.warn('[spotify-embedded] data-target が CSS セレクタとして不正です: ' + options.target);
    }
  }
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
    '  font-family: ' + FONT_STACK + ';',
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

  // API 由来の URL は https のものだけ使う（javascript: などを href に入れない）
  function isHttps(url) {
    return typeof url === 'string' && /^https:\/\//i.test(url);
  }

  // 取得できなかったときの表示。/badge.svg・/embed と同じ文言（src/render/card.ts）
  var UNAVAILABLE_LABEL = 'UNAVAILABLE';
  var UNAVAILABLE_TEXT = '取得できませんでした';

  /** data が null なら「取得できませんでした」のカードを描く。 */
  function renderCard(data) {
    var track = data && data.track;
    var mood = data && data.mood;
    var playing = !!(data && data.is_playing && track);

    var linkable = !!(track && isHttps(track.spotify_url));
    var card = document.createElement(linkable ? 'a' : 'div');
    card.className = 'card' + (track && !(mood && mood.text) ? ' no-mood' : '');
    if (linkable) {
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

    if (track && isHttps(track.album_art_url)) {
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
    var labelText = !data ? UNAVAILABLE_LABEL : track ? (playing ? 'NOW PLAYING' : 'LAST PLAYED') : 'NOTHING PLAYING';
    label.appendChild(el('span', null, labelText));
    body.appendChild(label);

    if (!track) {
      body.appendChild(el('p', 'idle', data ? '再生していません' : UNAVAILABLE_TEXT));
    } else {
      if (mood && mood.text) body.appendChild(el('p', 'mood', mood.text));
      body.appendChild(el('p', 'track', track.name));
      body.appendChild(el('p', 'artist', track.artist));
    }

    card.appendChild(body);
    return card;
  }

  // 取得の方針は /embed（src/render/page.ts）・public/demo.js と揃えている:
  // 非表示のタブでは取得しない・表示に戻ったらすぐ取り直す・1回の取得は TIMEOUT_MS で
  // 打ち切る・続けて失敗したら間隔を倍々に伸ばす（上限 MAX_DELAY_MS）。
  var TIMEOUT_MS = 10000;
  var MAX_DELAY_MS = Math.max(options.refresh * 1000, 15 * 60 * 1000);

  function get(path) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var abort = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);
    return fetch(base + path, {
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('request failed: ' + res.status);
      return res.json();
    }).then(
      function (data) { clearTimeout(abort); return data; },
      function (err) { clearTimeout(abort); throw err; }
    );
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // 前回描いた内容。同じなら DOM に触らない（作り直すとキーボードのフォーカスと
  // スクリーンリーダーの読み上げ位置が失われる）
  var lastKey = null;

  function show(data) {
    var key = JSON.stringify(data ? [
      !!data.is_playing,
      data.track ? [data.track.id, data.track.name, data.track.artist, data.track.album_art_url, data.track.spotify_url] : null,
      data.mood && data.mood.text ? data.mood.text : null
    ] : 'unavailable');
    if (key === lastKey) return;
    lastKey = key;
    clear(container);
    container.appendChild(renderCard(data));
  }

  var failures = 0;
  var timer = null;
  var loading = false;

  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(refresh, Math.min(options.refresh * 1000 * Math.pow(2, failures), MAX_DELAY_MS));
  }

  function refresh() {
    timer = null;
    // 非表示のタブでは取得しない（誰も見ていないカードのために API を叩かない）。
    // 表示に戻ったら下の visibilitychange ですぐ取り直す。
    if (document.hidden || loading) return;
    loading = true;
    get('/api/now-playing')
      .then(function (data) {
        failures = 0;
        show(data);
      }, function () {
        failures = Math.min(failures + 1, 10);
        // まだ何も描いていなければ「取得できませんでした」を出す。
        // 描いたものがあれば残し、次の更新に任せる
        if (lastKey === null) show(null);
      })
      .then(function () {
        loading = false;
        schedule();
      });
  }

  refresh();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
})();
