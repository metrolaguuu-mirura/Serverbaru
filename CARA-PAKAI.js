/**
 * ═══════════════════════════════════════════════════════════
 *  PANDUAN INTEGRASI MEGAPLAY DI FRONTEND MIRUROTV.COM
 * ═══════════════════════════════════════════════════════════
 *
 *  Worker URL:  https://miruro-scraper.metrolaguuu.workers.dev
 *  API Key:     miruro_mp_xK9mR2vL7nQ4wZ8j
 *  GitHub:      https://github.com/metrolaguuu-mirura/Serverbaru
 *
 * ═══════════════════════════════════════════════════════════
 *
 *  CARA 1: PAKAI SCRIPT INJECT (PALING GAMPANG)
 *  ─────────────────────────────────────────────
 *  Buka file halaman watch kamu (watch.astro atau sejenisnya).
 *  Tambahkan 1 baris ini SEBELUM tag </body>:
 *
 *    <script src="https://miruro-scraper.metrolaguuu.workers.dev/megaplay-inject.js"></script>
 *
 *  Contoh di file watch.astro:
 *
 *    <html>
 *    <body>
 *      ...konten halaman watch...
 *      ...player video...
 *      ...tombol server...
 *
 *      <script src="https://miruro-scraper.metrolaguuu.workers.dev/megaplay-inject.js"></script>
 *    </body>   ← SEBELUM INI
 *    </html>
 *
 *  Otomatis:
 *    ✅ Tombol "MegaPlay" muncul di panel server
 *    ✅ Preload m3u8 saat halaman buka
 *    ✅ Klik = instant play
 *
 *
 *  CARA 2: PAKAI LANGSUNG DI KODE KAMU (LEBIH FLEKSIBEL)
 *  ────────────────────────────────────────────────────────
 *
 *  // ─── A. Ambil m3u8 URL ───
 *  async function getMegaPlayUrl(episodeId) {
 *    const res = await fetch(
 *      `https://miruro-scraper.metrolaguuu.workers.dev/api/episode/${episodeId}/megaplay`,
 *      { headers: { 'X-API-Key': 'miruro_mp_xK9mR2vL7nQ4wZ8j' } }
 *    );
 *    const data = await res.json();
 *    // Return proxy URL (segment sudah di-proxy, tinggal putar)
 *    return `https://miruro-scraper.metrolaguuu.workers.dev/stream/${episodeId}/master.m3u8`;
 *  }
 *
 *  // ─── B. Putar di hls.js ───
 *  async function playMegaPlay(episodeId) {
 *    const streamUrl = await getMegaPlayUrl(episodeId);
 *    const hls = new Hls();
 *    hls.loadSource(streamUrl);
 *    hls.attachMedia(videoElement);
 *  }
 *
 *  // ─── C. Contoh di tombol server ───
 *  <button onclick="playMegaPlay(29145)">MegaPlay</button>
 *
 *
 *  CARA 3: INTEGRASI KE SYSTEM SERVER YANG SUDAH ADA
 *  ──────────────────────────────────────────────────
 *
 *  // Tambahkan ke daftar server yang sudah ada:
 *  const allServers = [
 *    { id: 'default', label: 'Default' },
 *    { id: 'kiwi',    label: 'Kiwi' },
 *    { id: 'bonk',    label: 'Bonk' },
 *    { id: 'bees',    label: 'Bees' },
 *    { id: 'ally',    label: 'Ally' },
 *    { id: 'peweh',   label: 'Peweh' },
 *    { id: 'hops',    label: 'Hops' },
 *    // ↓ TAMBAHKAN INI ↓
 *    { id: 'megaplay', label: 'MegaPlay', isExternal: true },
 *  ];
 *
 *  // Di fungsi switchServer(), tambahkan handling untuk megaplay:
 *  function switchServer(id) {
 *    if (id === 'megaplay') {
 *      // MegaPlay pakai worker proxy, bukan API biasa
 *      const streamUrl = `https://miruro-scraper.metrolaguuu.workers.dev/stream/${epId}/master.m3u8`;
 *      play(streamUrl, id);
 *      return;
 *    }
 *    // Server lain tetap seperti biasa
 *    fetch('/api/episode/' + epId + '/stream?server=' + id)
 *      .then(r => r.json())
 *      .then(data => play(data.data.stream_url, id));
 *  }
 *
 *
 * ═══════════════════════════════════════════════════════════
 *  ENDPOINT YANG TERSEDIA
 * ═══════════════════════════════════════════════════════════
 *
 *  Stream (tanpa API key, dari miruratv.com):
 *    GET /stream/{episodeId}/master.m3u8   → HLS master playlist (proxy)
 *    GET /stream/{episodeId}/seg/*         → Video segments (proxy)
 *
 *  API (butuh X-API-Key header):
 *    GET  /api/episode/{id}/megaplay       → Ambil m3u8 URL + metadata
 *    POST /api/scrape/{id}                 → Scrap 1 episode
 *    POST /api/scrape-batch                → Scrap massal
 *    GET  /api/episodes?anime_id=X         → List episodes per anime
 *
 *
 * ═══════════════════════════════════════════════════════════
 *  CONTOH RESPONSE /api/episode/{id}/megaplay
 * ═══════════════════════════════════════════════════════════
 *
 *  {
 *    "episode_id": 1,
 *    "server": "megaplay",
 *    "m3u8_url": "https://cdn.imgnex.top/anime/.../master.m3u8",
 *    "tracks": [
 *      { "file": "...eng.vtt", "label": "English" },
 *      { "file": "...spa.vtt", "label": "Spanish" }
 *    ],
 *    "intro":  { "start": 138, "end": 215 },
 *    "outro":  { "start": 1452, "end": 1542 },
 *    "source": "database"
 *  }
 *
 * ═══════════════════════════════════════════════════════════
 */
