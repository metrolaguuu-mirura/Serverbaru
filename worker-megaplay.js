/**
 * MegaPlay Stream Scraper — Cloudflare Worker + D1 (SECURED)
 *
 * Keamanan:
 *   1. API Key wajib untuk semua endpoint
 *   2. CORS hanya untuk miruratv.com
 *   3. Origin/Referer checking
 *   4. Rate limiting (50 request/menit per IP)
 *   5. Block akses browser langsung
 */

// ═══════════════════════════════════════════
// KONFIGURASI KEAMANAN — GANTI SEMUA INI
// ═══════════════════════════════════════════
const CONFIG = {
  // API Key — WAJIB sama di frontend dan worker
  // Generate random key: https://www.random.org/strings/
  API_KEYS: [
    'miruro_mp_xK9mR2vL7nQ4wZ8j',   // key 1 (frontend)
    'miruro_mp_pT5hY3bN6cF1dA9s',   // key 2 (backup)
  ],

  // Domain yang diizinkan (frontend kamu)
  ALLOWED_ORIGINS: [
    'https://miruratv.com',
    'https://www.miruratv.com',
    'https://miruro.tv',
    'https://www.miruro.tv',
  ],

  // Rate limit
  RATE_LIMIT: 50,        // max request per window
  RATE_WINDOW: 60,       // window dalam detik
};
// ═══════════════════════════════════════════

const MEGAPLAY_BASE = 'https://megaplay.buzz';
const MEGAPLAY_REFERER = 'https://anistream.one/';
const SESSION_TTL = 25 * 60 * 1000;

const memCache = new Map();
const rateLimitMap = new Map();

// ─── CORS (hanya domain kamu) ───
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const isAllowed = CONFIG.ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o));

  if (isAllowed) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Allow-Credentials': 'true',
    };
  }
  // Origin tidak diizinkan → tetap block
  return {
    'Access-Control-Allow-Origin': CONFIG.ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  };
}

function json(data, status, request) {
  return Response.json(data, {
    status,
    headers: { ...getCorsHeaders(request) },
  });
}

function error(msg, status, request) {
  return json({ error: msg }, status, request);
}

// ─── AUTH CHECK ───
function checkApiKey(request) {
  // Cek header X-API-Key
  const apiKey = request.headers.get('X-API-Key') || request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) return false;
  return CONFIG.API_KEYS.includes(apiKey);
}

// ─── ORIGIN CHECK ───
function checkOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  const referer = request.headers.get('Referer') || '';

  // Untuk request dari browser (punya Origin/Referer)
  if (origin || referer) {
    const isAllowed = CONFIG.ALLOWED_ORIGINS.some(o =>
      origin === o || origin.startsWith(o + '/') ||
      referer === o || referer.startsWith(o + '/')
    );
    return isAllowed;
  }

  // Request tanpa Origin/Referer (server-to-server) → butuh API key
  // Akan di-check terpisah
  return true;
}

// ─── RATE LIMITING ───
function checkRateLimit(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const windowMs = CONFIG.RATE_WINDOW * 1000;

  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = { count: 0, start: now };
    rateLimitMap.set(ip, entry);
  }

  entry.count++;
  return entry.count <= CONFIG.RATE_LIMIT;
}

// ─── BLOCK BROWSER ACCESS ───
function isBrowser(request) {
  const ua = request.headers.get('User-Agent') || '';
  // Kalau request dari browser biasa (bukan fetch dari frontend)
  const secFetchSite = request.headers.get('Sec-Fetch-Site') || '';
  // sec-fetch-site: "none" = langsung buka URL di browser
  // sec-fetch-site: "same-origin" / "cross-site" = fetch dari frontend
  return secFetchSite === 'none' && !checkApiKey(request);
}

// ─── URL PARSER ───
function parseMiruroUrl(url) {
  const m = url.match(/\/watch\/(\d+)\/[^?]*\??(?:.*&)?ep=(\d+)/);
  if (!m) return null;
  return { anilist_id: parseInt(m[1]), episode_num: parseInt(m[2]) };
}

// ─── SCRAPING ───
async function scrapeFileId(anilistId, epNum, lang = 'sub') {
  const streamUrl = `${MEGAPLAY_BASE}/stream/ani/${anilistId}/${epNum}/${lang}`;
  const res = await fetch(streamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': MEGAPLAY_REFERER,
    },
  });
  if (!res.ok) throw new Error(`Stream page failed: ${res.status}`);
  const html = await res.text();
  if (html.includes('Error Code:') || html.includes("can't find the file")) {
    throw new Error('Episode not found or removed');
  }
  const match = html.match(/data-id="(\d+)"/);
  if (!match) throw new Error('Could not extract file_id');
  return match[1];
}

async function scrapeSources(fileId) {
  const url = `${MEGAPLAY_BASE}/stream/getSources?id=${fileId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Referer': MEGAPLAY_REFERER,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok) throw new Error(`getSources failed: ${res.status}`);
  const data = await res.json();

  // Mode 1: sources.file langsung ada (unencrypted)
  if (data.sources?.file) return data;

  // Mode 2: encrypted source (enc) — perlu decrypt AES-CBC
  if (data.enc) {
    const decrypted = await decryptEnc(data.enc);
    data.sources = { file: decrypted };
    return data;
  }

  throw new Error('No video source found');
}

// ─── DECRYPT ENCRYPTED SOURCE (AES-CBC) ───
// Key dari newclient.min.js: "i?LMTAx0Q6,:}50U"
// IV: "enc_i"
async function decryptEnc(encStr) {
  // Key: "i?LMTAx0Q6,:}50U" padded ke 32 bytes dengan zeros
  const keyStr = 'i?LMTAx0Q6,:}50U';
  const keyBytes = new Uint8Array(32);
  const encoder = new TextEncoder();
  const keyEncoded = encoder.encode(keyStr);
  keyBytes.set(keyEncoded.subarray(0, Math.min(32, keyEncoded.length)));

  // IV: "enc_i" padded ke 16 bytes dengan zeros
  const ivBytes = new Uint8Array(16);
  ivBytes.set(encoder.encode('enc_i'));

  // Import key
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']
  );

  // Base64url decode: replace - → +, _ → /, pad =
  let b64 = encStr.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);

  // Decode base64 ke bytes
  const binaryStr = atob(b64);
  const cipherBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    cipherBytes[i] = binaryStr.charCodeAt(i);
  }

  // Decrypt AES-CBC
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: ivBytes }, cryptoKey, cipherBytes
  );

  const raw = new TextDecoder().decode(decrypted);

  // IV mismatch causes 16 bytes garbage at start — extract clean URL
  // Look for m3u8 URL pattern in decrypted output
  const urlMatch = raw.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
  if (urlMatch) return urlMatch[0];

  // Fallback: try to find CDN domain directly
  const cdnMatch = raw.match(/cdn\.[^\s"']+\.m3u8[^\s"']*/);
  if (cdnMatch) return 'https://' + cdnMatch[0];

  return raw.replace(/[^\x20-\x7E]/g, '').trim();
}

async function scrapeMegaplay(anilistId, epNum, lang = 'sub') {
  const fileId = await scrapeFileId(anilistId, epNum, lang);
  const raw = await scrapeSources(fileId);
  return {
    file_id: fileId,
    m3u8_url: raw.sources.file,
    tracks: raw.tracks || [],
    intro: raw.intro || null,
    outro: raw.outro || null,
    expires_at: Date.now() + SESSION_TTL,
  };
}

function getCached(episodeId) {
  const c = memCache.get(episodeId);
  if (c && Date.now() < c.expires_at) return c;
  return null;
}

function rewritePlaylist(body, baseUrl, episodeId, workerOrigin) {
  const base = new URL(baseUrl);
  return body.split('\n').map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    try {
      const abs = new URL(t, base).href;
      const u = new URL(abs);
      // Rewrite semua CDN segment ke proxy worker
      return `${workerOrigin}/stream/${episodeId}/seg/${u.host}${u.pathname}${u.search}`;
    } catch { return line; }
  }).join('\n');
}

// Fetch master + semua sub-playlist → gabung jadi 1 playlist + rewrite segments
async function rewriteAllPlaylists(masterBody, masterUrl, episodeId, workerOrigin) {
  const masterBase = new URL(masterUrl);
  const lines = masterBody.split('\n');

  // Cek apakah ini master playlist (punya STREAM-INF) atau langsung media playlist
  const isMaster = lines.some(l => l.includes('EXT-X-STREAM-INF'));

  if (!isMaster) {
    // Langsung media playlist — rewrite segments saja
    return rewritePlaylist(masterBody, masterUrl, episodeId, workerOrigin);
  }

  // Master playlist — fetch sub-playlist pertama (biasanya cuma ada 1 quality)
  let subPlaylistUrl = null;
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith('#') && t.includes('.m3u8')) {
      subPlaylistUrl = new URL(t, masterBase).href;
      break;
    }
  }

  if (!subPlaylistUrl) {
    // Fallback: rewrite langsung
    return rewritePlaylist(masterBody, masterUrl, episodeId, workerOrigin);
  }

  // Fetch sub-playlist
  try {
    const subRes = await fetch(subPlaylistUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': MEGAPLAY_BASE + '/' },
    });
    if (!subRes.ok) {
      return rewritePlaylist(masterBody, masterUrl, episodeId, workerOrigin);
    }
    const subBody = await subRes.text();
    // Rewrite segment URLs di sub-playlist ke proxy worker
    return rewritePlaylist(subBody, subPlaylistUrl, episodeId, workerOrigin);
  } catch {
    return rewritePlaylist(masterBody, masterUrl, episodeId, workerOrigin);
  }
}

// ─── MAIN ───
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(request);

    // PREFLIGHT
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const workerOrigin = `${url.protocol}//${url.host}`;

    // ─── KEAMANAN: Segment proxy TIDAK perlu API key ───
    // hls.js player memanggil segment langsung, tidak bisa inject header
    const segMatch = path.match(/^\/stream\/(\d+)\/seg\/(.+)$/);
    if (segMatch) {
      const segUrl = `https://${segMatch[2]}${url.search}`;
      const segRes = await fetch(segUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': MEGAPLAY_BASE + '/' },
      });
      if (!segRes.ok) return new Response('Segment fetch failed', { status: 502, headers: corsHeaders });
      return new Response(segRes.body, {
        headers: {
          'Content-Type': segRes.headers.get('Content-Type') || 'video/mp2t',
          'Cache-Control': 'max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // ─── KEAMANAN LAYER 1: Block browser langsung ───
    if (isBrowser(request)) {
      return new Response('Access Denied', { status: 403, headers: corsHeaders });
    }

    // ─── KEAMANAN LAYER 2: Origin check ───
    if (!checkOrigin(request) && !checkApiKey(request)) {
      return json({ error: 'Forbidden: Origin not allowed' }, 403, request);
    }

    // ─── KEAMANAN LAYER 3: API Key untuk API endpoints ───
    // Stream endpoints (master.m3u8) boleh tanpa API key kalau dari origin yang diizinkan
    const isStreamEndpoint = /^\/stream\/\d+\/master\.m3u8$/.test(path);
    if (!checkApiKey(request) && !isStreamEndpoint) {
      return json({ error: 'Unauthorized: Invalid or missing API key. Use X-API-Key header.' }, 401, request);
    }

    // ─── KEAMANAN LAYER 4: Rate limiting ───
    if (!checkRateLimit(request)) {
      return json({ error: 'Too many requests. Try again later.' }, 429, request);
    }

    try {
      // ─── POST /api/scrape/:episodeId ───
      const scrapeMatch = path.match(/^\/api\/scrape\/(\d+)$/);
      if (scrapeMatch && request.method === 'POST') {
        const episodeId = parseInt(scrapeMatch[1]);
        const body = await request.json().catch(() => ({}));
        const lang = body.lang || 'sub';

        const ep = await env.DB.prepare('SELECT * FROM episodes WHERE id = ?').bind(episodeId).first();
        if (!ep) return error('Episode not found', 404, request);

        const parsed = parseMiruroUrl(ep.url);
        if (!parsed) return error('Cannot parse URL', 400, request);

        const scraped = await scrapeMegaplay(parsed.anilist_id, parsed.episode_num, lang);
        await env.DB.prepare(
          'UPDATE episodes SET m3u8_url_megaplay = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(scraped.m3u8_url, episodeId).run();

        memCache.set(episodeId, { ...scraped, episode_id: episodeId });
        return json({
          episode_id: episodeId,
          server: 'megaplay', lang,
          m3u8_url: scraped.m3u8_url,
          tracks: scraped.tracks,
          intro: scraped.intro,
          outro: scraped.outro,
          stream_url: `${workerOrigin}/stream/${episodeId}/master.m3u8`,
        }, 200, request);
      }

      // ─── POST /api/scrape-batch ───
      if (path === '/api/scrape-batch' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { lang = 'sub', limit = 20, anime_id } = body;

        let query;
        if (anime_id) {
          query = env.DB.prepare(`
            SELECT id, url FROM episodes
            WHERE anime_id = ? AND (m3u8_url_megaplay IS NULL OR m3u8_url_megaplay = '')
            ORDER BY id ASC LIMIT ?
          `).bind(String(anime_id), limit);
        } else {
          query = env.DB.prepare(`
            SELECT id, url FROM episodes
            WHERE m3u8_url_megaplay IS NULL OR m3u8_url_megaplay = ''
            ORDER BY id ASC LIMIT ?
          `).bind(limit);
        }
        const { results: episodes } = await query.all();

        const results = [];
        for (const ep of episodes) {
          const parsed = parseMiruroUrl(ep.url);
          if (!parsed) { results.push({ episode_id: ep.id, status: 'skip' }); continue; }
          try {
            const scraped = await scrapeMegaplay(parsed.anilist_id, parsed.episode_num, lang);
            await env.DB.prepare(
              'UPDATE episodes SET m3u8_url_megaplay = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(scraped.m3u8_url, ep.id).run();
            results.push({ episode_id: ep.id, status: 'ok' });
          } catch (e) {
            results.push({ episode_id: ep.id, status: 'error', reason: e.message });
          }
        }
        return json({ total: episodes.length, results }, 200, request);
      }

      // ─── GET /api/episode/:id/megaplay ───
      const epMpMatch = path.match(/^\/api\/episode\/(\d+)\/megaplay$/);
      if (epMpMatch && request.method === 'GET') {
        const episodeId = parseInt(epMpMatch[1]);
        const lang = url.searchParams.get('lang') || 'sub';

        const cached = getCached(episodeId);
        if (cached) return json({ episode_id: episodeId, server: 'megaplay', ...cached }, 200, request);

        const ep = await env.DB.prepare('SELECT id, url, m3u8_url_megaplay FROM episodes WHERE id = ?').bind(episodeId).first();
        if (!ep) return error('Episode not found', 404, request);

        if (ep.m3u8_url_megaplay) {
          const data = { m3u8_url: ep.m3u8_url_megaplay, source: 'database' };
          memCache.set(episodeId, { ...data, expires_at: Date.now() + SESSION_TTL });
          return json({ episode_id: episodeId, server: 'megaplay', ...data }, 200, request);
        }

        const parsed = parseMiruroUrl(ep.url);
        if (!parsed) return error('Cannot parse URL', 400, request);
        const scraped = await scrapeMegaplay(parsed.anilist_id, parsed.episode_num, lang);
        await env.DB.prepare(
          'UPDATE episodes SET m3u8_url_megaplay = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(scraped.m3u8_url, episodeId).run();
        memCache.set(episodeId, { ...scraped, expires_at: Date.now() + SESSION_TTL });
        return json({
          episode_id: episodeId, server: 'megaplay', lang,
          m3u8_url: scraped.m3u8_url,
          tracks: scraped.tracks,
          intro: scraped.intro, outro: scraped.outro,
          stream_url: `${workerOrigin}/stream/${episodeId}/master.m3u8`,
          source: 'scraped',
        }, 200, request);
      }

      // ─── GET /api/episodes?anime_id=X ───
      if (path === '/api/episodes' && request.method === 'GET') {
        const animeId = url.searchParams.get('anime_id');
        if (!animeId) return error('anime_id required', 400, request);
        const { results } = await env.DB.prepare(
          'SELECT id, anime_id, episode_number, title, m3u8_url, m3u8_url_megaplay, thumbnail, air_date FROM episodes WHERE anime_id = ? ORDER BY episode_number ASC'
        ).bind(String(animeId)).all();
        return json(results, 200, request);
      }

      // ─── GET /stream/:episodeId/master.m3u8 (PROXY — terbuka dari miruratv.com) ───
      const masterMatch = path.match(/^\/stream\/(\d+)\/master\.m3u8$/);
      if (masterMatch) {
        const episodeId = parseInt(masterMatch[1]);
        const cached = getCached(episodeId);
        let m3u8Url = cached?.m3u8_url;

        if (!m3u8Url) {
          const ep = await env.DB.prepare('SELECT id, url, m3u8_url_megaplay FROM episodes WHERE id = ?').bind(episodeId).first();
          if (!ep) return error('Episode not found', 404, request);
          m3u8Url = ep.m3u8_url_megaplay;

          if (!m3u8Url) {
            const parsed = parseMiruroUrl(ep.url);
            if (!parsed) return error('Cannot parse URL', 400, request);
            const scraped = await scrapeMegaplay(parsed.anilist_id, parsed.episode_num);
            await env.DB.prepare(
              'UPDATE episodes SET m3u8_url_megaplay = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(scraped.m3u8_url, episodeId).run();
            m3u8Url = scraped.m3u8_url;
            memCache.set(episodeId, { ...scraped, expires_at: Date.now() + SESSION_TTL });
          }
        }

        // Fetch master + sub-playlist, rewrite semua URL ke proxy
        const masterRes = await fetch(m3u8Url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': MEGAPLAY_BASE + '/' },
        });
        if (!masterRes.ok) {
          memCache.delete(episodeId);
          const ep = await env.DB.prepare('SELECT url FROM episodes WHERE id = ?').bind(episodeId).first();
          const parsed = parseMiruroUrl(ep.url);
          const scraped = await scrapeMegaplay(parsed.anilist_id, parsed.episode_num);
          await env.DB.prepare(
            'UPDATE episodes SET m3u8_url_megaplay = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
          ).bind(scraped.m3u8_url, episodeId).run();
          memCache.set(episodeId, { ...scraped, expires_at: Date.now() + SESSION_TTL });
          const retryRes = await fetch(scraped.m3u8_url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': MEGAPLAY_BASE + '/' },
          });
          if (!retryRes.ok) return error('m3u8 fetch failed', 502, request);
          const body = await retryRes.text();
          const rewritten = await rewriteAllPlaylists(body, scraped.m3u8_url, episodeId, workerOrigin);
          return new Response(rewritten, {
            headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache', ...corsHeaders },
          });
        }

        const body = await masterRes.text();
        // Rewrite: master playlist → sub-playlist URLs jadi absolute
        // Sub-playlist → segment URLs jadi proxy worker
        const rewritten = await rewriteAllPlaylists(body, m3u8Url, episodeId, workerOrigin);
        return new Response(rewritten, {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache', ...corsHeaders },
        });
      }

      // ─── GET / — info ───
      if (path === '/') {
        return json({
          name: 'MegaPlay Scraper (Secured)',
          status: 'online',
          note: 'Stream endpoints terbuka untuk miruratv.com. API endpoints butuh X-API-Key.',
        }, 200, request);
      }

      return error('Not found', 404, request);
    } catch (err) {
      return error(err.message || String(err), 500, request);
    }
  },
};
