/**
 * ライブAPIのデモ画面（public/index.html）のスクリプト。
 *
 * CSP（script-src 'self'）で動くよう、インラインではなくこのファイルに置いている。
 * 取得の方針は /embed（src/render/page.ts）・public/embed.js と揃えている:
 * 非表示のタブでは取得しない・表示に戻ったらすぐ取り直す・1回の取得は TIMEOUT_MS で
 * 打ち切る・続けて失敗したら間隔を倍々に伸ばす（上限 MAX_DELAY_MS）。
 */
(function () {
  'use strict';

  var INTERVAL_MS = 30000;
  var TIMEOUT_MS = 10000;
  var MAX_DELAY_MS = 15 * 60 * 1000;

  function $(id) {
    return document.getElementById(id);
  }

  // API 由来の URL は https のものだけ使う（javascript: などを src に入れない）
  function isHttps(url) {
    return typeof url === 'string' && /^https:\/\//i.test(url);
  }

  // 429・503 の Retry-After（秒）。次の取得を少なくともその時間は待つ（倍々の間隔より長ければこちらを使う）
  function retryAfterMs(res) {
    var value = res.headers.get('Retry-After');
    return value && /^\d+$/.test(value) ? Number(value) * 1000 : 0;
  }

  var waitAtLeastMs = 0;

  function fetchNowPlaying() {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var abort = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);
    return fetch('/api/now-playing', { signal: controller ? controller.signal : undefined })
      .then(function (res) {
        if (!res.ok) {
          if (res.status === 429 || res.status === 503) waitAtLeastMs = retryAfterMs(res);
          throw new Error('HTTP ' + res.status);
        }
        return res.json();
      })
      .then(
        function (data) {
          clearTimeout(abort);
          renderNowPlaying(data);
        },
        function (err) {
          clearTimeout(abort);
          $('status-msg').textContent = '再生中の曲を取得できませんでした';
          throw err;
        }
      );
  }

  function renderNowPlaying(data) {
    var placeholder = $('album-art-placeholder');
    var img = $('album-art');

    if (!data.is_playing || !data.track) {
      img.hidden = true;
      placeholder.hidden = false;
      placeholder.textContent = '再生中の曲はありません';
      $('track-name').textContent = '';
      $('artist-name').textContent = '';
      $('mood-text').textContent = '';
      $('status-msg').textContent = '';
      return;
    }

    var t = data.track;

    // アルバムアート。画像の無い曲では URL が空になる
    if (isHttps(t.album_art_url)) {
      img.src = t.album_art_url;
      img.hidden = false;
      placeholder.hidden = true;
    } else {
      img.hidden = true;
      placeholder.hidden = false;
      placeholder.textContent = '';
    }

    $('track-name').textContent = t.name;
    $('artist-name').textContent = t.artist;
    $('mood-text').textContent = data.mood ? data.mood.text : '';
    $('status-msg').textContent = '再生中';
  }

  var failures = 0;
  var timer = null;
  var loading = false;

  function schedule() {
    if (timer !== null) clearTimeout(timer);
    var delay = Math.max(Math.min(INTERVAL_MS * Math.pow(2, failures), MAX_DELAY_MS), waitAtLeastMs);
    waitAtLeastMs = 0;
    timer = setTimeout(tick, delay);
  }

  function tick() {
    // 待機中の取得があれば取り消す（表示に戻ったときに呼ばれても、周期を1本に保つ）
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (document.hidden || loading) return;
    loading = true;
    fetchNowPlaying()
      .then(
        function () { failures = 0; },
        function () { failures = Math.min(failures + 1, 10); }
      )
      .then(function () {
        loading = false;
        schedule();
      });
  }

  tick();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tick();
  });
})();
