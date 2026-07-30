/* ==========================================================================
   Rafayel & Mery — wedding invitation server
   Serves the static site AND a small JSON API that stores RSVPs in SQLite.

   Run:   node --no-warnings server.js
   Site:  http://localhost:8000
   Admin: http://localhost:8000/admin.html   (key below)

   Zero dependencies — uses only Node built-ins (node:http + node:sqlite).
   Requires Node 22.5+ for node:sqlite.
   ========================================================================== */
'use strict';

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/* ----- CONFIG (edit these) ------------------------------------------------- */
const PORT      = process.env.PORT || 8000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'rafmery2026';   // password for the admin page
const DB_PATH   = path.join(__dirname, 'data', 'rsvp.db');
const MAX_PERSONS = 10;

/* ----- database ------------------------------------------------------------ */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS rsvps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    attendance  TEXT    NOT NULL,
    persons     INTEGER NOT NULL DEFAULT 1,
    side        TEXT,
    lang        TEXT,
    created_at  TEXT    NOT NULL
  );
`);

const insertRsvp = db.prepare(
  `INSERT INTO rsvps (name, attendance, persons, side, lang, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const selectAll = db.prepare(`SELECT * FROM rsvps ORDER BY id DESC`);
const selectStats = db.prepare(`
  SELECT
    COUNT(*)                                                   AS responses,
    COALESCE(SUM(attendance = 'yes'), 0)                       AS yes,
    COALESCE(SUM(attendance = 'no'),  0)                       AS no,
    COALESCE(SUM(CASE WHEN attendance = 'yes' THEN persons ELSE 0 END), 0) AS totalPersons
  FROM rsvps
`);

/* ----- helpers ------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg':  'image/jpeg',  '.jpeg': 'image/jpeg',
  '.png':  'image/png',   '.svg':  'image/svg+xml',
  '.webp': 'image/webp',  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',  '.m4a':  'audio/mp4',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 1e5) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > limit) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function isAuthorized(req, url) {
  const key = req.headers['x-admin-key'] || url.searchParams.get('key');
  return key === ADMIN_KEY;
}

/* ----- static files -------------------------------------------------------- */
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.join(__dirname, rel);

  // path-traversal guard: never serve outside the project folder
  if (!filePath.startsWith(__dirname)) { res.writeHead(403).end('Forbidden'); return; }
  // never serve the database
  if (filePath.startsWith(path.join(__dirname, 'data'))) { res.writeHead(403).end('Forbidden'); return; }

  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
    });
    res.end(buf);
  });
}

/* ----- server -------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  /* --- POST /api/rsvp : store one response --- */
  if (pathname === '/api/rsvp' && req.method === 'POST') {
    try {
      const parsed = JSON.parse(await readBody(req) || '{}');

      const name = String(parsed.name || '').trim().slice(0, 120);
      const attendance = parsed.attendance === 'yes' ? 'yes'
                       : parsed.attendance === 'no'  ? 'no' : null;

      if (!name)       return sendJson(res, 400, { ok: false, error: 'name required' });
      if (!attendance) return sendJson(res, 400, { ok: false, error: 'attendance required' });

      let persons = parseInt(parsed.persons, 10);
      if (!Number.isFinite(persons)) persons = 1;
      persons = attendance === 'yes' ? Math.min(Math.max(persons, 1), MAX_PERSONS) : 0;

      const side = String(parsed.side || '').slice(0, 40);
      const lang = ['am', 'en', 'ru'].includes(parsed.lang) ? parsed.lang : 'am';

      insertRsvp.run(name, attendance, persons, side, lang, new Date().toISOString());
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error('POST /api/rsvp failed:', err);
      return sendJson(res, 500, { ok: false, error: 'server error' });
    }
  }

  /* --- GET /api/rsvps : admin-only list + totals --- */
  if (pathname === '/api/rsvps' && req.method === 'GET') {
    if (!isAuthorized(req, url)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    try {
      const stats = selectStats.get();
      const rows  = selectAll.all();
      return sendJson(res, 200, { ok: true, stats, rows });
    } catch (err) {
      console.error('GET /api/rsvps failed:', err);
      return sendJson(res, 500, { ok: false, error: 'server error' });
    }
  }

  /* --- unknown API route --- */
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'not found' });

  /* --- static site --- */
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);

  res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`\n  Rafayel & Mery — invitation server`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Invitation : http://localhost:${PORT}`);
  console.log(`  Admin page : http://localhost:${PORT}/admin.html`);
  console.log(`  Admin key  : ${ADMIN_KEY}`);
  console.log(`  Database   : ${DB_PATH}\n`);
});
