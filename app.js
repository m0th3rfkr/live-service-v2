
// LIVE SERVICE – Estadísticas y partidos en vivo (API-Football + Football-Data)
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- Football-Data.org ---
app.get('/stats/matches', async (req, res) => {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN;
    if (!token) return res.status(400).json({ error: 'Falta FOOTBALL_DATA_TOKEN' });

    const params = new URLSearchParams();
    if (req.query.dateFrom) params.set('dateFrom', String(req.query.dateFrom));
    if (req.query.dateTo) params.set('dateTo', String(req.query.dateTo));
    if (req.query.competition) params.set('competitions', String(req.query.competition));

    const url = `https://api.football-data.org/v4/matches${params.toString() ? '?' + params.toString() : ''}`;
    const r = await fetch(url, { headers: { 'X-Auth-Token': token } });
    const json = await r.json();

    res.json({ source: 'football-data.org', url, data: json });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fallo en /stats/matches', details: String(err) });
  }
});

// --- API-FOOTBALL (live scores) ---
app.get('/stats/fixtures', async (req, res) => {
  try {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) return res.status(400).json({ error: 'Falta API_FOOTBALL_KEY' });

    const base = 'https://v3.football.api-sports.io/fixtures';
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) qs.set(k, String(v));

    const url = `${base}${qs.toString() ? '?' + qs.toString() : ''}`;
    const r = await fetch(url, { headers: { 'x-apisports-key': key } });
    const json = await r.json();

    res.json({ source: 'api-football (apisports)', url, data: json });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fallo en /stats/fixtures', details: String(err) });
  }
});

// --- Health ---
app.get('/health', (_req, res) => res.json({ ok: true, service: 'live' }));

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Live service listo en http://localhost:${PORT}`));

// --- /embed/live : página HTML lista para incrustar (cache 30s) ---
let liveCache = { at: 0, html: '' };

app.get('/embed/live', async (_req, res) => {
  try {
    // cache 30s
    if (Date.now() - liveCache.at < 30_000 && liveCache.html) {
      res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
      return res.type('html').send(liveCache.html);
    }

    // pedir partidos en vivo a API-FOOTBALL
    const url = 'https://v3.football.api-sports.io/fixtures?live=all';
    const r = await fetch(url, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY } });
    const j = await r.json();
    const arr = (j.data && j.data.response) ? j.data.response : [];

    // construir tarjetas
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
            <div class="team"><img src="${h?.logo||''}"><span>${h?.name||'TBD'}</span></div>
            <div class="score">${x.goals?.home ?? 0} — ${x.goals?.away ?? 0}</div>
            <div class="team"><span>${a?.name||'TBD'}</span><img src="${a?.logo||''}"></div>
          </div>
        </div>`;
    }).join('') || `<div class="empty">Sin partidos ahora.</div>`;

    const html = `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Partidos en vivo</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto; background:#0b1539; color:#eaf0ff}
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
    res.status(500).type('html').send('<p style="color:white">error live embed</p>');
  }
});


