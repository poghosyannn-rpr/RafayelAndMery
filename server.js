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

const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

/* ----- CONFIG (edit these) ------------------------------------------------- */
const PORT      = process.env.PORT || 8000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'rafmery2026';   // password for the admin page
// In production set DB_PATH to a path on a PERSISTENT volume (e.g. /data/rsvp.db),
// otherwise the database is wiped on every redeploy.
const DB_PATH   = process.env.DB_PATH || path.join(__dirname, 'data', 'rsvp.db');
const MAX_PERSONS = 10;
const DEFAULT_CAPACITY = 12;   // seats per round table
const MAX_MANUAL_GUESTS = 20;  // most people one manual "add" can create at once
const OWNER_USERNAME = (process.env.OWNER_USERNAME || 'rafmery').toLowerCase();
const OWNER_DISPLAY  = process.env.OWNER_DISPLAY  || 'Rafayel & Mery';
const SESSION_DAYS   = 30;

if (process.env.NODE_ENV === 'production' && ADMIN_KEY === 'rafmery2026') {
  console.warn('  ⚠  ADMIN_KEY is still the default — set it as an env var on your host!\n');
}

/* ----- database ------------------------------------------------------------ */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA foreign_keys = ON;`);

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

  /* Round tables on the reception floor plan. */
  CREATE TABLE IF NOT EXISTS seat_tables (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    number      INTEGER NOT NULL,
    x           REAL    NOT NULL DEFAULT 60,
    y           REAL    NOT NULL DEFAULT 60,
    capacity    INTEGER NOT NULL DEFAULT 12,
    created_at  TEXT    NOT NULL
  );

  /* Accounts. The secret key is stored as a scrypt hash, never in plaintext. */
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT    NOT NULL UNIQUE,
    display_name TEXT,
    key_salt     TEXT    NOT NULL,
    key_hash     TEXT    NOT NULL,
    is_owner     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL
  );

  /* Login sessions — in the database so they survive a restart. */
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  /* One row per PERSON (an RSVP for 4 becomes 4 rows). */
  CREATE TABLE IF NOT EXISTS guests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    side        TEXT,
    source      TEXT    NOT NULL DEFAULT 'form',   -- 'form' | 'manual'
    rsvp_id     INTEGER,
    party_ix    INTEGER NOT NULL DEFAULT 0,
    table_id    INTEGER REFERENCES seat_tables(id) ON DELETE SET NULL,
    removed     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
  );
`);

/* Migration: group_id ties the members of one party together so the guest list
   can show "how many people came under this name". Older databases won't have
   it, so add it and backfill. */
let needsNameBackfill = false;

(function migrateGuestColumns() {
  const cols = db.prepare(`PRAGMA table_info(guests)`).all().map(c => c.name);

  if (!cols.includes('group_id')) {
    db.exec(`ALTER TABLE guests ADD COLUMN group_id TEXT`);
    // form guests group by their RSVP; existing manual guests become groups of one
    db.exec(`UPDATE guests SET group_id = 'rsvp:'   || rsvp_id WHERE rsvp_id IS NOT NULL`);
    db.exec(`UPDATE guests SET group_id = 'manual:' || id      WHERE rsvp_id IS NULL`);
    console.log('  migrated: guests.group_id added');
  }

  // manual ordering of the guest list (drag to reorder)
  if (!cols.includes('sort_ix')) {
    db.exec(`ALTER TABLE guests ADD COLUMN sort_ix INTEGER`);
    db.exec(`UPDATE guests SET sort_ix = id`);
    console.log('  migrated: guests.sort_ix added');
  }

  // root_name = the party's base name; other_names = the other members, comma separated
  if (!cols.includes('root_name')) {
    db.exec(`ALTER TABLE guests ADD COLUMN root_name TEXT`);
    db.exec(`ALTER TABLE guests ADD COLUMN other_names TEXT`);
    console.log('  migrated: guests.root_name + other_names added');
    needsNameBackfill = true;
  }

  // optional label for each table ("Family", "Head table", …)
  const tcols = db.prepare(`PRAGMA table_info(seat_tables)`).all().map(c => c.name);
  if (!tcols.includes('name')) {
    db.exec(`ALTER TABLE seat_tables ADD COLUMN name TEXT`);
    console.log('  migrated: seat_tables.name added');
  }
  // round or rectangular tables
  if (!tcols.includes('shape')) {
    db.exec(`ALTER TABLE seat_tables ADD COLUMN shape TEXT NOT NULL DEFAULT 'circle'`);
    console.log('  migrated: seat_tables.shape added');
  }

  // multi-user: every row belongs to an account
  for (const t of ['rsvps', 'guests', 'seat_tables']) {
    const c = db.prepare(`PRAGMA table_info(${t})`).all().map(x => x.name);
    if (!c.includes('user_id')) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_user ON ${t}(user_id)`);
      console.log(`  migrated: ${t}.user_id added`);
    }
  }
})();

/* ----- accounts ------------------------------------------------------------ */
function hashKey(key, salt) {
  return crypto.scryptSync(String(key), salt, 64).toString('hex');
}
function makeUser(username, displayName, key, isOwner = 0) {
  const salt = crypto.randomBytes(16).toString('hex');
  return db.prepare(
    `INSERT INTO users (username, display_name, key_salt, key_hash, is_owner, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(String(username).toLowerCase().trim(), displayName || null,
        salt, hashKey(key, salt), isOwner ? 1 : 0, new Date().toISOString());
}
function verifyKey(user, key) {
  const a = Buffer.from(hashKey(key, user.key_salt), 'hex');
  const b = Buffer.from(user.key_hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const qUserByName = db.prepare(`SELECT * FROM users WHERE username = ?`);
const qUserById   = db.prepare(`SELECT * FROM users WHERE id = ?`);
const qAllUsers   = db.prepare(
  `SELECT id, username, display_name, is_owner, created_at FROM users ORDER BY id`
);
const qOwner      = db.prepare(`SELECT * FROM users WHERE is_owner = 1 LIMIT 1`);

/* First run: create the owner from ADMIN_KEY and hand it every existing row. */
(function bootstrapOwner() {
  if (db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n > 0) return;
  const info = makeUser(OWNER_USERNAME, OWNER_DISPLAY, ADMIN_KEY, 1);
  const ownerId = Number(info.lastInsertRowid);
  ['rsvps', 'guests', 'seat_tables'].forEach(t =>
    db.exec(`UPDATE ${t} SET user_id = ${ownerId} WHERE user_id IS NULL`));
  console.log(`  created owner "${OWNER_USERNAME}" and assigned all existing data to it`);
})();

/* ----- sessions ------------------------------------------------------------ */
db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());

function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const exp = new Date(now.getTime() + SESSION_DAYS * 86400000);
  db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)`)
    .run(token, userId, now.toISOString(), exp.toISOString());
  return token;
}

/* The logged-in user for this request, or null. */
function currentUser(req, url) {
  const token = req.headers['x-session'] || url?.searchParams.get('session');
  if (token) {
    const s = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(String(token));
    if (s && s.expires_at > new Date().toISOString()) return qUserById.get(s.user_id) || null;
  }
  // legacy: the raw admin key still authenticates as the owner
  const key = req.headers['x-admin-key'] || url?.searchParams.get('key');
  if (key && key === ADMIN_KEY) return qOwner.get() || null;
  return null;
}

/* Every statement below is scoped by user_id: reads filter by it, and writes
   carry "AND user_id = ?" so one account can never touch another's row even if
   it guesses a valid id. */
const insertRsvp = db.prepare(
  `INSERT INTO rsvps (name, attendance, persons, side, lang, created_at, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const selectAll = db.prepare(`SELECT * FROM rsvps WHERE user_id = ? ORDER BY id DESC`);
const selectStats = db.prepare(`
  SELECT
    COUNT(*)                                                   AS responses,
    COALESCE(SUM(attendance = 'yes'), 0)                       AS yes,
    COALESCE(SUM(attendance = 'no'),  0)                       AS no,
    COALESCE(SUM(CASE WHEN attendance = 'yes' THEN persons ELSE 0 END), 0) AS totalPersons
  FROM rsvps WHERE user_id = ?
`);

/* ----- guests / seating statements ----------------------------------------- */
const qAttendingRsvps = db.prepare(
  `SELECT id, name, persons, side FROM rsvps
    WHERE attendance = 'yes' AND user_id = ? ORDER BY id`
);
// counts EVERY row incl. soft-deleted, so removed people are never resurrected
const qGuestCountForRsvp = db.prepare(`SELECT COUNT(*) AS n FROM guests WHERE rsvp_id = ?`);
const insertGuest = db.prepare(
  `INSERT INTO guests (name, side, source, rsvp_id, party_ix, created_at, group_id, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const qGuests = db.prepare(
  `SELECT id, name, side, source, rsvp_id, party_ix, table_id, created_at,
          group_id, sort_ix, root_name, other_names
     FROM guests WHERE removed = 0 AND user_id = ?
    ORDER BY COALESCE(sort_ix, id), id`
);
const updGuestSort = db.prepare(`UPDATE guests SET sort_ix = ? WHERE id = ? AND user_id = ?`);
const qGroupMembers = db.prepare(
  `SELECT id FROM guests WHERE group_id = ? AND removed = 0 AND user_id = ? ORDER BY party_ix, id`
);
const qGuest        = db.prepare(`SELECT * FROM guests WHERE id = ? AND removed = 0 AND user_id = ?`);
const qSeatTables   = db.prepare(`SELECT * FROM seat_tables WHERE user_id = ? ORDER BY number`);
const qSeatTable    = db.prepare(`SELECT * FROM seat_tables WHERE id = ? AND user_id = ?`);
const qSeatedCount  = db.prepare(
  `SELECT COUNT(*) AS n FROM guests WHERE table_id = ? AND removed = 0 AND user_id = ?`
);
const updGuestTable = db.prepare(`UPDATE guests SET table_id = ? WHERE id = ? AND user_id = ?`);
const updGuestName  = db.prepare(`UPDATE guests SET name = ? WHERE id = ? AND user_id = ?`);
const updGuestSide  = db.prepare(`UPDATE guests SET side = ? WHERE id = ? AND user_id = ?`);
const softDelGuest  = db.prepare(
  `UPDATE guests SET removed = 1, table_id = NULL WHERE id = ? AND user_id = ?`
);
const insertTable   = db.prepare(
  `INSERT INTO seat_tables (number, x, y, capacity, created_at, shape, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const qNextTableNo  = db.prepare(
  `SELECT COALESCE(MAX(number), 0) + 1 AS n FROM seat_tables WHERE user_id = ?`
);
const qTableCount   = db.prepare(`SELECT COUNT(*) AS n FROM seat_tables WHERE user_id = ?`);
const delTable      = db.prepare(`DELETE FROM seat_tables WHERE id = ? AND user_id = ?`);

/* Naming for a party member: a single guest keeps the bare name, a group of N
   becomes "Name 1" … "Name N". */
function partyMemberName(name, index, total) {
  return total > 1 ? `${name} ${index + 1}` : name;
}

/* "Rafayel 1"/"Rafayel 2" -> "Rafayel"; a lone guest keeps their name. */
function baseNameOf(members) {
  if (members.length === 1) return members[0].name;
  const m = members[0].name.match(/^(.*?)[\s,]*\d+$/);
  return m && m[1].trim() ? m[1].trim() : members[0].name;
}

/* Keep the denormalised name columns in step for one party:
     root_name   = the party's base name (same on every member row)
     other_names = comma-separated names of the members after the first
   Called after any rename / resize so the columns always match reality. */
const qGroupRows = db.prepare(
  `SELECT id, name, party_ix FROM guests
    WHERE group_id = ? AND removed = 0 AND user_id = ? ORDER BY party_ix, id`
);
const updGroupNames = db.prepare(`UPDATE guests SET root_name = ?, other_names = ? WHERE id = ?`);

function refreshGroupNames(gid, userId, rootOverride) {
  if (!gid) return;
  const rows = qGroupRows.all(gid, userId);
  if (!rows.length) return;
  const root   = rootOverride || baseNameOf(rows);
  const others = rows.slice(1).map(r => r.name).join(', ');
  rows.forEach(r => updGroupNames.run(root, others, r.id));
}

/* Materialise one guest row per person for every attending RSVP.
   Additive only → renames, seat assignments and removals are never clobbered. */
function syncGuestsFromRsvps(userId) {
  const now = new Date().toISOString();
  let added = 0;
  for (const r of qAttendingRsvps.all(userId)) {
    const have = qGuestCountForRsvp.get(r.id).n;
    const want = Math.max(1, r.persons || 1);
    for (let i = have; i < want; i++) {
      insertGuest.run(partyMemberName(r.name, i, want), r.side || '', 'form',
                      r.id, i, now, 'rsvp:' + r.id, userId);
      added++;
    }
    if (have < want) refreshGroupNames('rsvp:' + r.id, userId, r.name);
  }
  return added;
}

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

/* ----- static files -------------------------------------------------------- */
function serveStatic(req, res, pathname) {
  // /u/<username> is one couple's invitation — same page, different workspace
  const uMatch = pathname.match(/^\/u\/([a-z0-9-]+)\/?$/i);
  if (uMatch) {
    if (!qUserByName.get(uMatch[1].toLowerCase())) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No invitation found for "' + uMatch[1] + '"');
    }
    pathname = '/';
  }
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.join(__dirname, rel);

  // path-traversal guard: never serve outside the project folder
  if (!filePath.startsWith(__dirname)) { res.writeHead(403).end('Forbidden'); return; }
  // never serve the database
  if (filePath.startsWith(path.join(__dirname, 'data'))) { res.writeHead(403).end('Forbidden'); return; }

  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    // Never let the browser keep a stale copy of the markup/code: a cached
    // admin.html paired with fresh JS (or vice-versa) breaks the page.
    const noCache = ext === '.html' || ext === '.js' || ext === '.css';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': noCache ? 'no-cache, must-revalidate' : 'public, max-age=86400',
    });
    res.end(buf);
  });
}

/* ----- server -------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  /* Someone typed an /api/... URL into the address bar: send them to the real
     UI instead of a wall of JSON. fetch() sends Accept: *\/* so the app itself
     is unaffected. */
  if (pathname.startsWith('/api/') && req.method === 'GET' &&
      (req.headers.accept || '').includes('text/html')) {
    res.writeHead(302, { Location: '/admin.html', 'Cache-Control': 'no-store' });
    return res.end();
  }

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

      // which account owns this RSVP: /u/<username> decides, "/" belongs to the owner
      let target = null;
      if (parsed.user) {
        target = qUserByName.get(String(parsed.user).toLowerCase().trim());
        if (!target) return sendJson(res, 404, { ok: false, error: 'unknown invitation' });
      } else {
        target = qOwner.get();
      }
      if (!target) return sendJson(res, 500, { ok: false, error: 'no account configured' });

      insertRsvp.run(name, attendance, persons, side, lang, new Date().toISOString(), target.id);
      syncGuestsFromRsvps(target.id);   // turn the new party into individual seatable people
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error('POST /api/rsvp failed:', err);
      return sendJson(res, 500, { ok: false, error: 'server error' });
    }
  }

  /* --- POST /api/login : username + secret key -> session token --- */
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const b = JSON.parse(await readBody(req) || '{}');
      const uname = String(b.username || '').toLowerCase().trim();
      const key   = String(b.key || '');
      const user  = uname ? qUserByName.get(uname) : null;
      // deliberately vague: never reveal which half was wrong
      if (!user || !key || !verifyKey(user, key)) {
        return sendJson(res, 401, { ok: false, error: 'wrong username or key' });
      }
      return sendJson(res, 200, {
        ok: true,
        token: newSession(user.id),
        user: { username: user.username, display_name: user.display_name, is_owner: !!user.is_owner },
      });
    } catch (err) {
      console.error('POST /api/login failed:', err);
      return sendJson(res, 500, { ok: false, error: 'server error' });
    }
  }

  /* --- POST /api/logout --- */
  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = req.headers['x-session'];
    if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(String(token));
    return sendJson(res, 200, { ok: true });
  }

  /* --- GET /api/rsvps : admin-only list + totals --- */
  if (pathname === '/api/rsvps' && req.method === 'GET') {
    const me = currentUser(req, url);
    if (!me) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    try {
      const stats = selectStats.get(me.id);
      const rows  = selectAll.all(me.id);
      return sendJson(res, 200, {
        ok: true, stats, rows,
        me: { username: me.username, display_name: me.display_name, is_owner: !!me.is_owner },
      });
    } catch (err) {
      console.error('GET /api/rsvps failed:', err);
      return sendJson(res, 500, { ok: false, error: 'server error' });
    }
  }

  /* ======================================================================
     User management — owner only
     ====================================================================== */
  if (pathname.startsWith('/api/users') || pathname === '/api/my-key') {
    const me = currentUser(req, url);
    if (!me) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    try {
      /* change my own key — available to everyone */
      if (pathname === '/api/my-key' && req.method === 'PATCH') {
        const b = JSON.parse(await readBody(req) || '{}');
        const key = String(b.key || '');
        if (key.length < 4) return sendJson(res, 400, { ok: false, error: 'key too short' });
        const salt = crypto.randomBytes(16).toString('hex');
        db.prepare(`UPDATE users SET key_salt = ?, key_hash = ? WHERE id = ?`)
          .run(salt, hashKey(key, salt), me.id);
        db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(me.id);   // force re-login
        return sendJson(res, 200, { ok: true });
      }

      if (!me.is_owner) return sendJson(res, 403, { ok: false, error: 'owner only' });

      const idPart = pathname.split('/')[3];
      const uid = /^\d+$/.test(idPart || '') ? parseInt(idPart, 10) : null;

      /* list users, with how much data each holds */
      if (pathname === '/api/users' && req.method === 'GET') {
        const rows = qAllUsers.all().map(u => ({
          ...u,
          guests: db.prepare(`SELECT COUNT(*) AS n FROM guests WHERE user_id = ? AND removed = 0`).get(u.id).n,
          tables: db.prepare(`SELECT COUNT(*) AS n FROM seat_tables WHERE user_id = ?`).get(u.id).n,
          rsvps:  db.prepare(`SELECT COUNT(*) AS n FROM rsvps WHERE user_id = ?`).get(u.id).n,
        }));
        return sendJson(res, 200, { ok: true, users: rows });
      }

      /* create a user */
      if (pathname === '/api/users' && req.method === 'POST') {
        const b = JSON.parse(await readBody(req) || '{}');
        const uname = String(b.username || '').toLowerCase().trim();
        const key   = String(b.key || '');
        if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(uname)) {
          return sendJson(res, 400, { ok: false, error: 'username: letters, numbers and dashes (2-31 chars)' });
        }
        if (key.length < 4) return sendJson(res, 400, { ok: false, error: 'key too short' });
        if (qUserByName.get(uname)) return sendJson(res, 409, { ok: false, error: 'username already exists' });
        const info = makeUser(uname, String(b.display_name || '').trim() || uname, key, 0);
        return sendJson(res, 200, { ok: true, id: Number(info.lastInsertRowid) });
      }

      /* reset another user's key */
      if (uid && pathname === `/api/users/${uid}` && req.method === 'PATCH') {
        const b = JSON.parse(await readBody(req) || '{}');
        const target = qUserById.get(uid);
        if (!target) return sendJson(res, 404, { ok: false, error: 'user not found' });
        if (typeof b.display_name === 'string') {
          db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(b.display_name.trim(), uid);
        }
        if (typeof b.key === 'string' && b.key) {
          if (b.key.length < 4) return sendJson(res, 400, { ok: false, error: 'key too short' });
          const salt = crypto.randomBytes(16).toString('hex');
          db.prepare(`UPDATE users SET key_salt = ?, key_hash = ? WHERE id = ?`)
            .run(salt, hashKey(b.key, salt), uid);
          db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(uid);
        }
        return sendJson(res, 200, { ok: true });
      }

      /* delete a user and everything they own */
      if (uid && pathname === `/api/users/${uid}` && req.method === 'DELETE') {
        const target = qUserById.get(uid);
        if (!target) return sendJson(res, 404, { ok: false, error: 'user not found' });
        if (target.is_owner) return sendJson(res, 400, { ok: false, error: 'cannot delete the owner' });
        ['guests', 'seat_tables', 'rsvps'].forEach(t =>
          db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(uid));
        db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(uid);
        db.prepare(`DELETE FROM users WHERE id = ?`).run(uid);
        return sendJson(res, 200, { ok: true });
      }
    } catch (err) {
      console.error(`${req.method} ${pathname} failed:`, err);
      return sendJson(res, 500, { ok: false, error: 'server error' });
    }
    return sendJson(res, 404, { ok: false, error: 'not found' });
  }

  /* ======================================================================
     Seating / guest management — every route below is admin-only
     ====================================================================== */
  if (pathname.startsWith('/api/seating') ||
      pathname.startsWith('/api/guests')  ||
      pathname.startsWith('/api/group')   ||
      pathname.startsWith('/api/tables')) {

    const me = currentUser(req, url);
    if (!me) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    const uid = me.id;

    // trailing path segment as a number, e.g. /api/guests/12 -> 12
    const idPart = pathname.split('/')[3];
    const id = /^\d+$/.test(idPart || '') ? parseInt(idPart, 10) : null;

    try {
      /* --- GET /api/seating : tables + people + stats --- */
      if (pathname === '/api/seating' && req.method === 'GET') {
        const tables = qSeatTables.all(uid);
        const guests = qGuests.all(uid);

        // party_size = how many people were added together under this name
        const groupCount = {};
        guests.forEach(g => {
          const k = g.group_id || ('solo:' + g.id);
          groupCount[k] = (groupCount[k] || 0) + 1;
        });
        guests.forEach(g => {
          g.party_size = groupCount[g.group_id || ('solo:' + g.id)];
        });
        const stats = {
          total:    guests.length,
          seated:   guests.filter(g => g.table_id != null).length,
          unseated: guests.filter(g => g.table_id == null).length,
          groom:    guests.filter(g => (g.side || '').includes('groom')).length,
          bride:    guests.filter(g => (g.side || '').includes('bride')).length,
          manual:   guests.filter(g => g.source === 'manual').length,
          tables:   tables.length,
        };
        return sendJson(res, 200, { ok: true, tables, guests, stats });
      }

      /* --- POST /api/guests : add one or several people by hand ---
         count > 1 creates "Name 1" … "Name N"; count == 1 uses the bare name. */
      if (pathname === '/api/guests' && req.method === 'POST') {
        const b = JSON.parse(await readBody(req) || '{}');
        const name = String(b.name || '').trim().slice(0, 120);
        if (!name) return sendJson(res, 400, { ok: false, error: 'name required' });
        const side = ['groom', 'bride', ''].includes(b.side) ? b.side : '';

        let count = parseInt(b.count, 10);
        if (!Number.isFinite(count)) count = 1;
        count = Math.min(Math.max(count, 1), MAX_MANUAL_GUESTS);

        const now = new Date().toISOString();
        // one group id for this batch, so the list can show the party size
        const gid = 'manual:' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const ids = [];
        for (let i = 0; i < count; i++) {
          const info = insertGuest.run(partyMemberName(name, i, count), side, 'manual', null, i, now, gid, uid);
          ids.push(Number(info.lastInsertRowid));
        }
        refreshGroupNames(gid, uid, name);
        return sendJson(res, 200, { ok: true, ids, count });
      }

      /* --- PATCH /api/guests/:id : rename / re-side / seat / unseat --- */
      if (id && pathname === `/api/guests/${id}` && req.method === 'PATCH') {
        const b = JSON.parse(await readBody(req) || '{}');
        if (!qGuest.get(id, uid)) return sendJson(res, 404, { ok: false, error: 'guest not found' });

        if (typeof b.name === 'string') {
          const nm = b.name.trim().slice(0, 120);
          if (!nm) return sendJson(res, 400, { ok: false, error: 'name required' });
          updGuestName.run(nm, id, uid);
          // keep root_name / other_names in step with the edit
          const g = qGuest.get(id, uid);
          if (g) refreshGroupNames(g.group_id, uid, g.party_ix === 0 ? nm : null);
        }
        if (typeof b.side === 'string' && ['groom', 'bride', ''].includes(b.side)) {
          updGuestSide.run(b.side, id, uid);
        }
        if ('table_id' in b) {
          if (b.table_id === null) {
            updGuestTable.run(null, id, uid);
          } else {
            const t = qSeatTable.get(Number(b.table_id), uid);
            if (!t) return sendJson(res, 404, { ok: false, error: 'table not found' });
            // capacity is enforced here, so two admins can't overfill a table
            const seated = qSeatedCount.get(t.id, uid).n;
            const alreadyHere = qGuest.get(id, uid).table_id === t.id;
            if (!alreadyHere && seated >= t.capacity) {
              return sendJson(res, 409, { ok: false, error: 'table full', capacity: t.capacity });
            }
            updGuestTable.run(t.id, id, uid);
          }
        }
        return sendJson(res, 200, { ok: true });
      }

      /* --- PATCH /api/guests/order : persist the drag-to-reorder sequence ---
         Body: { groups: [group_id, …] } in the new display order. */
      if (pathname === '/api/guests/order' && req.method === 'PATCH') {
        const b = JSON.parse(await readBody(req) || '{}');
        const groups = Array.isArray(b.groups) ? b.groups : null;
        if (!groups) return sendJson(res, 400, { ok: false, error: 'groups array required' });

        let ix = 0;
        for (const gid of groups) {
          for (const row of qGroupMembers.all(String(gid), uid)) updGuestSort.run(ix++, row.id, uid);
        }
        return sendJson(res, 200, { ok: true, ordered: ix });
      }

      /* --- PATCH /api/group : resize a party (the editable Qty cell) ---
         Grows by adding members to the same group, shrinks by soft-deleting the
         last ones. Custom names are preserved; only auto-numbered ones adjust. */
      if (pathname === '/api/group' && req.method === 'PATCH') {
        const b = JSON.parse(await readBody(req) || '{}');
        const gid = String(b.group_id || '');
        if (!gid) return sendJson(res, 400, { ok: false, error: 'group_id required' });

        const qMembers = db.prepare(
          `SELECT * FROM guests WHERE group_id = ? AND removed = 0 AND user_id = ?
            ORDER BY party_ix, id`
        );
        const members = qMembers.all(gid, uid);
        if (!members.length) return sendJson(res, 404, { ok: false, error: 'group not found' });

        let count = parseInt(b.count, 10);
        if (!Number.isFinite(count)) return sendJson(res, 400, { ok: false, error: 'count required' });
        count = Math.min(Math.max(count, 1), MAX_MANUAL_GUESTS);

        const cur  = members.length;
        const base = baseNameOf(members);
        const lead = members[0];

        if (count > cur) {
          const now = new Date().toISOString();
          // the lone member of a 1-person party becomes "Name 1"
          if (cur === 1 && lead.name === base) updGuestName.run(`${base} 1`, lead.id, uid);
          let ix = Math.max(...members.map(m => m.party_ix)) + 1;
          for (let i = cur; i < count; i++, ix++) {
            insertGuest.run(`${base} ${i + 1}`, lead.side || '', lead.source,
                            lead.rsvp_id ?? null, ix, now, gid, uid);
          }
        } else if (count < cur) {
          members.slice(count).forEach(m => softDelGuest.run(m.id, uid));
          // shrinking back to one: drop the trailing "1" if it's auto-generated
          if (count === 1) {
            const only = members[0];
            if (only.name === `${base} 1`) updGuestName.run(base, only.id, uid);
          }
        }

        refreshGroupNames(gid, uid, base);
        return sendJson(res, 200, { ok: true, count: qMembers.all(gid, uid).length });
      }

      /* --- DELETE /api/guests/:id : soft-delete --- */
      if (id && pathname === `/api/guests/${id}` && req.method === 'DELETE') {
        if (!qGuest.get(id, uid)) return sendJson(res, 404, { ok: false, error: 'guest not found' });
        softDelGuest.run(id, uid);
        return sendJson(res, 200, { ok: true });
      }

      /* --- POST /api/tables : add a round table --- */
      if (pathname === '/api/tables' && req.method === 'POST') {
        const b = JSON.parse(await readBody(req) || '{}');
        const number = Number.isFinite(+b.number) && +b.number > 0
          ? Math.floor(+b.number) : qNextTableNo.get(uid).n;
        const capacity = Number.isFinite(+b.capacity) && +b.capacity > 0
          ? Math.min(Math.floor(+b.capacity), 30) : DEFAULT_CAPACITY;
        // stagger new tables so they don't stack on top of each other
        const shape = b.shape === 'rect' ? 'rect' : 'circle';
        const i = qTableCount.get(uid).n;
        const x = Number.isFinite(+b.x) ? +b.x : 60 + (i % 4) * 340;
        const y = Number.isFinite(+b.y) ? +b.y : 60 + Math.floor(i / 4) * 280;
        const info = insertTable.run(number, x, y, capacity, new Date().toISOString(), shape, uid);
        return sendJson(res, 200, { ok: true, id: Number(info.lastInsertRowid), number, shape });
      }

      /* --- PATCH /api/tables/:id : move / renumber / resize --- */
      if (id && pathname === `/api/tables/${id}` && req.method === 'PATCH') {
        const b = JSON.parse(await readBody(req) || '{}');
        const t = qSeatTable.get(id, uid);
        if (!t) return sendJson(res, 404, { ok: false, error: 'table not found' });

        const x = Number.isFinite(+b.x) ? Math.max(0, +b.x) : t.x;
        const y = Number.isFinite(+b.y) ? Math.max(0, +b.y) : t.y;
        const number = Number.isFinite(+b.number) && +b.number > 0 ? Math.floor(+b.number) : t.number;
        let capacity = Number.isFinite(+b.capacity) && +b.capacity > 0
          ? Math.min(Math.floor(+b.capacity), 30) : t.capacity;
        // never shrink below the people already seated there
        const seated = qSeatedCount.get(id, uid).n;
        if (capacity < seated) capacity = seated;

        const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : t.name;

        db.prepare(`UPDATE seat_tables SET x=?, y=?, number=?, capacity=?, name=? WHERE id=? AND user_id=?`)
          .run(x, y, number, capacity, name || null, id, uid);
        return sendJson(res, 200, { ok: true });
      }

      /* --- DELETE /api/tables/:id : remove (its guests become unseated) --- */
      if (id && pathname === `/api/tables/${id}` && req.method === 'DELETE') {
        if (!qSeatTable.get(id, uid)) return sendJson(res, 404, { ok: false, error: 'table not found' });
        // unseat everyone here explicitly (don't rely on the FK pragma being on)
        db.prepare(`UPDATE guests SET table_id = NULL WHERE table_id = ? AND user_id = ?`).run(id, uid);
        delTable.run(id, uid);
        return sendJson(res, 200, { ok: true });
      }
    } catch (err) {
      console.error(`${req.method} ${pathname} failed:`, err);
      return sendJson(res, 500, { ok: false, error: 'server error' });
    }

    return sendJson(res, 404, { ok: false, error: 'not found' });
  }

  /* --- unknown API route --- */
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'not found' });

  /* --- static site --- */
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);

  res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method not allowed');
});

// bring every account's guest list up to date with RSVPs received while we were down
let synced = 0;
for (const u of qAllUsers.all()) synced += syncGuestsFromRsvps(u.id);

// one-off: fill root_name / other_names for parties that pre-date those columns
if (needsNameBackfill) {
  const gids = db.prepare(
    `SELECT DISTINCT group_id, user_id FROM guests
      WHERE group_id IS NOT NULL AND removed = 0`
  ).all();
  gids.forEach(r => refreshGroupNames(r.group_id, r.user_id));
  console.log(`  backfilled names for ${gids.length} parties`);
}

server.listen(PORT, () => {
  const owner = qOwner.get();
  console.log(`\n  Rafayel & Mery — invitation server`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Invitation : http://localhost:${PORT}`);
  console.log(`  Admin page : http://localhost:${PORT}/admin.html`);
  console.log(`  Owner login: ${owner ? owner.username : '(none)'} / ${ADMIN_KEY}`);
  console.log(`  Accounts   : ${qAllUsers.all().length}`);
  console.log(`  Database   : ${DB_PATH}`);
  if (synced) console.log(`  Guests     : +${synced} created from RSVPs`);
  console.log('');
});
