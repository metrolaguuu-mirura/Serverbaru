/**
 * MegaPlay Server Injector untuk MiruroTV — FAST EDITION
 *
 * Optimasi:
 *   1. Preload m3u8 LANGSUNG saat halaman buka (bukan nunggu klik)
 *   2. Skip API call — langsung pakai /stream/:id/master.m3u8
 *   3. Pre-warm connection ke worker (DNS + TLS handshake)
 *   4. Klik = INSTANT PLAY (data sudah siap di cache worker)
 */

(function() {
  // ═══════════════════════════════════════
  var WORKER_URL = 'https://miruro-scraper.metrolaguuu.workers.dev';
  var API_KEY = 'miruro_mp_xK9mR2vL7nQ4wZ8j';
  var SERVER_ID = 'megaplay';
  var SERVER_LABEL = 'MegaPlay';
  // ═══════════════════════════════════════

  var STREAM_URL = null;  // akan di-set setelah preload
  var preloadDone = false;

  // ─── STEP 1: Pre-warm connection (DNS + TLS) ───
  // Ini bikin koneksi ke worker sudah siap sebelum user klik
  function prewarm() {
    var link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = WORKER_URL;
    link.crossOrigin = '';
    document.head.appendChild(link);

    // Juga preconnect ke CDN segment (biar segment fetch cepat)
    var link2 = document.createElement('link');
    link2.rel = 'dns-prefetch';
    link2.href = WORKER_URL;
    document.head.appendChild(link2);
  }

  // ─── STEP 2: Preload manifest (fetch m3u8 + cache di worker) ───
  function preloadManifest() {
    if (typeof epId === 'undefined') return;
    STREAM_URL = WORKER_URL + '/stream/' + epId + '/master.m3u8';

    // Fetch manifest sekali — ini bikin worker:
    //   a. Cek D1 (cepat, <1ms)
    //   b. Fetch master m3u8 dari CDN
    //   c. Fetch sub-playlist dari CDN
    //   d. Rewrite + cache di memory
    // Jadi saat user klik, hls.js tinggal fetch lagi → worker return INSTANT dari cache
    fetch(STREAM_URL, {
      method: 'GET',
      headers: { 'Origin': window.location.origin },
      // Jangan tunggu response — cukup mulai fetch
    }).then(function(r) {
      if (r.ok) preloadDone = true;
    }).catch(function() {});
  }

  // ─── STEP 3: Tambah tombol + setup ───
  function init() {
    var srvButtons = document.getElementById('srv-buttons');
    if (!srvButtons) {
      setTimeout(init, 300);
      return;
    }
    if (srvButtons.querySelector('[data-srv="megaplay"]')) return;

    // Pre-warm + preload sekarang
    prewarm();
    preloadManifest();

    // Buat tombol
    var btn = document.createElement('button');
    btn.className = 'srv-btn';
    btn.setAttribute('data-srv', SERVER_ID);
    btn.textContent = SERVER_LABEL;
    btn.style.borderLeft = '2px solid #f59e0b';

    btn.addEventListener('click', function() {
      switchToMegaplay();
    });

    srvButtons.appendChild(btn);
  }

  // ─── Switch ke MegaPlay (INSTANT karena sudah di-preload) ───
  function switchToMegaplay() {
    var video = document.getElementById('miruro-video');
    if (!video || !STREAM_URL) return;

    // Update tombol aktif
    var btns = document.querySelectorAll('.srv-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-srv') === SERVER_ID);
    }

    // Langsung putar — stream URL sudah siap dari preload
    playMegaplay(STREAM_URL);
  }

  // ─── Putar video ───
  function playMegaplay(streamUrl) {
    var video = document.getElementById('miruro-video');
    if (!video) return;

    // Destroy HLS lama
    if (window._mpHls) {
      try { window._mpHls.stopLoad(); window._mpHls.destroy(); } catch(e) {}
      window._mpHls = null;
    }

    video.removeAttribute('src');
    video.load();

    // Show loading
    var overlay = document.getElementById('player-overlay');
    var spinner = document.getElementById('player-spinner');
    if (overlay) overlay.style.display = 'flex';
    if (spinner) spinner.style.display = 'block';

    if (window.Hls && Hls.isSupported()) {
      var hls = new Hls({
        enableWorker: true,
        maxBufferLength: 120,
        maxMaxBufferLength: 300,
        maxBufferSize: 100 * 1000 * 1000,
        backBufferLength: 30,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 4,
        abrEwmaDefaultEstimate: 1500000,
        startLevel: -1,
        testBandwidth: true,
        useFetch: false
      });
      window._mpHls = hls;
      hls.attachMedia(video);
      hls.loadSource(streamUrl);

      hls.on(Hls.Events.MANIFEST_PARSED, function() {
        if (overlay) overlay.style.display = 'none';
        if (spinner) spinner.style.display = 'none';
        video.play().catch(function() {});
      });

      hls.on(Hls.Events.ERROR, function(evt, data) {
        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
            try { hls.startLoad(); } catch(e) {}
          }
          return;
        }
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            showError('MegaPlay: Network error');
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            try { hls.recoverMediaError(); } catch(e) {
              try { hls.swapAudioCodec(); hls.recoverMediaError(); } catch(e2) {
                showError('MegaPlay: Media error');
              }
            }
            break;
          default:
            showError('MegaPlay: Error');
        }
      });

      video.addEventListener('waiting', function() {
        if (overlay) overlay.style.display = 'flex';
        if (spinner) spinner.style.display = 'block';
      });
      video.addEventListener('playing', function() {
        if (overlay) overlay.style.display = 'none';
        if (spinner) spinner.style.display = 'none';
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', function() {
        if (overlay) overlay.style.display = 'none';
        if (spinner) spinner.style.display = 'none';
        video.play().catch(function() {});
      }, { once: true });
    }
  }

  function showError(msg) {
    var overlay = document.getElementById('player-overlay');
    var spinner = document.getElementById('player-spinner');
    var errorEl = document.getElementById('player-error');
    var errorMsg = document.getElementById('player-error-msg');
    if (overlay) overlay.style.display = 'flex';
    if (spinner) spinner.style.display = 'none';
    if (errorEl) errorEl.style.display = 'block';
    if (errorMsg) errorMsg.textContent = msg;
  }

  // ─── Tunggu epId tersedia ───
  function waitForEpId() {
    if (typeof epId !== 'undefined') {
      init();
    } else {
      setTimeout(waitForEpId, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForEpId);
  } else {
    waitForEpId();
  }
})();
