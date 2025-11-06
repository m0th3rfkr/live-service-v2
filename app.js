// LIVE SERVICE – Estadísticas y partidos en vivo
// API-Football (APISports) + Football-Data.org
// ---------------------------------------------
const express = require('express');
const fetch = require('node-fetch'); // v2
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Helpers
const escapeXml = s => (s || '').replace(/[<>&'"]/g, c => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
}[c]));

// ----------------------------------------------------
// 1) football-data.org  (fixtures/resultados generales)
// ----------------------------------------------------
app.get('/stats/matches', async (req, res) => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (!token) return res.status(400).json({ error: 'Falta FOOTBALL_DATA_TOKEN' });

    const qs = new URLSearchParams();
    if (req.query.dateFrom) qs.set('dateFrom', String(req.query.dateFrom));
    if (req.query.dateTo) qs.set('dateTo', String(req.query.dateTo));
    if (req.query.competition) qs.set('competitions', String(req.query.competition));

    const url = `https://api.football-data.org/v4/matches${qs.toString() ? '?' + qs : ''}`;
    const r = await fetch(url, { headers: { 'X-Auth-Token': token } });
    const json = await r.json();

    res.json({ source: 'football-data.org', url, data: json });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fallo en /stats/matches', details: String(err) });
  }
});

// ----------------------------------------------------
// 2) API-FOOTBALL (APISports)  – live/por fecha/liga
// ----------------------------------------------------
app.get('/stats/fixtures', async (req, res) => {
  try {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) return res.status(400).json({ error: 'Falta API_FOOTBALL_KEY' });

    const base = 'https://v3.football.api-sports.io/fixtures';
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) qs.set(k, String(v));
    const url = `${base}${qs.toString() ? '?' + qs : ''}`;

    const r = await fetch(url, { headers: { 'x-apisports-key': key } });
    const json = await r.json();

    res.json({ source: 'api-football (apisports)', url, data: json });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fallo en /stats/fixtures', details: String(err) });
  }
});

// -----------------
// 3) Health check
// -----------------
app.get('/health', (_req, res) => res.json({ ok: true, service: 'live' }));

// ----------------------------------------------------
// 4) /embed/live  – HTML listo para iframe (cache 30s)
// ----------------------------------------------------
let liveCache = { at: 0, html: '' };

app.get('/embed/live', async (_req, res) => {
  try {
    // cache 30s
    if (Date.now() - liveCache.at < 30_000 && liveCache.html) {
      res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
      return res.type('html').send(liveCache.html);
    }

    const key = process.env.API_FOOTBALL_KEY;
    if (!key) {
      return res
        .status(400)
        .type('html')
        .send('<p style="color:white">Falta API_FOOTBALL_KEY</p>');
    }

    // por default: vivos
    const url = 'https://v3.football.api-sports.io/fixtures?live=all';
    const r = await fetch(url, { headers: { 'x-apisports-key': key } });
    const j = await r.json();
    const arr = (j.data && j.data.response) ? j.data.response : [];

    const rows = arr.map(x => {
      const st = x.fixture?.status?.short || 'NS';
      const min = x.fixture?.status?.elapsed ?? '';
      const h = x.teams?.home, a = x.teams?.away;
      return `
        <div class="card">
          <div class="meta">${x.league?.country||''} • ${x.league?.name||''} • ${x.league?.round||''}
            <span class="chip">${st}${min?` · ${min}'`:''}</span>
          </div>
          <div class="row">
            <div class="team"><img src="${h?.logo||''}" alt=""><span>${h?.name||'TBD'}</span></div>
            <div class="score">${x.goals?.home ?? 0} — ${x.goals?.away ?? 0}</div>
            <div class="team"><span>${a?.name||'TBD'}</span><img src="${a?.logo||''}" alt=""></div>
          </div>
        </div>`;
    }).join('') || `<div class="empty">Sin partidos ahora.</div>`;

    const html = `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Partidos en vivo</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto;background:#0b1539;color:#eaf0ff}
  .wrap{padding:12px}
  .grid{display:grid;gap:10px}
  @media(min-width:680px){.grid{grid-template-columns:repeat(2,1fr)}}
  .card{background:#10214a;border:1px solid #213a7a;border-radius:12px;padding:12px}
  .meta{font-size:12px;opacity:.8;margin-bottom:6px}
  .row{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .team{display:flex;align-items:center;gap:8px}
  .team img{width:20px;height:20px;object-fit:contain;background:#061235;border-radius:4px}
  .score{font-size:18px;font-weight:800}
  .chip{font-size:12px;padding:2px 8px;border-radius:999px;background:#1a2d61;border:1px solid #213a7a}
  .empty{opacity:.7;text-align:center;padding:20px}
</style></head>
<body><div class="wrap"><div class="grid">${rows}</div></div></body></html>`;

    liveCache = { at: Date.now(), html };
    res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
    res.type('html').send(html);
  } catch (e) {
    console.error(e);
    res.status(500).type('html').send('<p style="color:white">error live embed</p>');
  }
});

// ----------------------------------------------------
// 5) /live/rss – feed RSS para GoodBarber (cache 30s)
//    Acepta query como ?live=all  ó  ?date=YYYY-MM-DD
//    ó  ?league=71&season=2025, etc.
// ----------------------------------------------------
let rssCache = { at: 0, xml: '' };

app.get('/live/rss', async (req, res) => {
  try {
    // cache 30s
    if (Date.now() - rssCache.at < 30_000 && rssCache.xml) {
      res.set('Cache-Control','public, max-age=30, s-maxage=30');
      return res.type('application/rss+xml').send(rssCache.xml);
    }

    const key = process.env.API_FOOTBALL_KEY;
    if (!key) return res.status(400).send('Falta API_FOOTBALL_KEY');

    const base = 'https://v3.football.api-sports.io/fixtures';
    const qs = new URLSearchParams();
    if (Object.keys(req.query).length === 0) qs.set('live', 'all'); // default
    for (const [k,v] of Object.entries(req.query)) qs.set(k, String(v));

    const url = `${base}?${qs.toString()}`;
    const r = await fetch(url, { headers: { 'x-apisports-key': key } });
    const j = await r.json();
    const arr = (j.data && j.data.response) ? j.data.response : [];

    const items = arr.map(x => {
      const st = x.fixture?.status?.short || 'NS';
      const min = x.fixture?.status?.elapsed ?? '';
      const h = x.teams?.home?.name || 'Home';
      const a = x.teams?.away?.name || 'Away';
      const hs = x.goals?.home ?? 0, as = x.goals?.away ?? 0;
      const title = `${h} ${hs}–${as} ${a} ${min ? `(${min}')` : ''} [${st}]`;
      const link = x.fixture?.id ? `https://www.api-football.com/fixture/${x.fixture.id}` : 'https://www.api-football.com/';
      const when = x.fixture?.date || new Date().toUTCString();
      const league = `${x.league?.country||''} • ${x.league?.name||''} • ${x.league?.round||''}`.trim();
      const venue = x.fixture?.venue?.name || '';
      return `
        <item>
          <title>${escapeXml(title)}</title>
          <link>${escapeXml(link)}</link>
          <guid>${x.fixture?.id || `${h}-${a}-${when}`}</guid>
          <pubDate>${when}</pubDate>
          <description><![CDATA[${league}<br/>${venue}]]></description>
        </item>`;
    }).join('') || `
      <item>
        <title>Sin partidos en vivo</title>
        <link>https://live-service-v2.onrender.com/health</link>
        <guid>no-live</guid>
        <pubDate>${new Date().toUTCString()}</pubDate>
        <description>No hay juegos activos ahora.</description>
      </item>`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>FIFA Live</title>
  <link>${req.protocol}://${req.get('host')}/stats/fixtures</link>
  <description>Partidos en vivo / API-FOOTBALL</description>
  ${items}
</channel></rss>`;

    rssCache = { at: Date.now(), xml };
    res.set('Cache-Control','public, max-age=30, s-maxage=30');
    res.type('application/rss+xml').send(xml);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error RSS live');
  }
});

// -------------------------
// 6) Start (al FINAL)
// -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Live service listo en http://localhost:${PORT}`);

  // listar rutas por consola (útil en Render logs)
  try {
    const routes = app._router.stack
      .filter(r => r.route)
      .map(r => `${Object.keys(r.route.methods)[0].toUpperCase()} ${r.route.path}`);
    console.log('Rutas:', routes);
  } catch { /* noop */ }
});
