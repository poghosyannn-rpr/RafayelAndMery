# Visitors — Wedding Invitation (Rafayel & Mery, 25.09.2026)

An animated single-page wedding invitation **plus** a small backend that stores RSVP
responses in a database, and a private admin page to view them.

No dependencies to install — the server uses only Node built-ins.
**Requires Node 22.5+** (uses the built-in `node:sqlite`). You have v22.16 ✓

## Run

```bash
node --no-warnings server.js
```

- **Invitation:** http://localhost:8000
- **Admin page:** http://localhost:8000/admin.html
- **Admin key:** `rafmery2026`  ← change it in `server.js`

> The site must be opened through the server (`http://localhost:8000`), **not** by
> double-clicking `index.html`. The RSVP form posts to the server's API, so a
> `file://` page cannot submit.

## Structure
```
server.js         HTTP server: serves the site + JSON API + SQLite  (CONFIG at top)
index.html        the invitation
admin.html        private RSVP dashboard
css/styles.css    palette (burgundy & blush-gold) + animations
css/admin.css     admin dashboard styles
js/i18n.js        ALL texts, in Armenian / English / Russian — edit here
js/main.js        envelope, language switch, calendar, countdown, RSVP submit (CONFIG at top)
js/admin.js       admin dashboard logic
assets/img/       photos (converted from your HEIC files)
assets/audio/     put your background track here as music.mp3
data/rsvp.db      the database — created automatically (git-ignored)
```

## Editing things

- **Texts** → `js/i18n.js` (every string exists three times: am/en/ru).
- **Wedding date, map links, max guests** → CONFIG block at the top of `js/main.js`
  (`WEDDING_DATE`, `WEDDING_MONTH`/`WEDDING_DAY` for the calendar highlight,
  `MAP_CEREMONY`, `MAP_RECEPTION`, `MAX_PERSONS`).
- **Port, admin key, db location** → CONFIG block at the top of `server.js`
  (or via env vars: `PORT=9000 ADMIN_KEY=secret node server.js`).
- **Photos** → drop web images in `assets/img/` and reference them in `index.html`.
- **Music** → add `assets/audio/music.mp3`; it starts when the envelope is opened.

## How RSVPs are stored

Guests fill the form (attending yes/no, **number of guests**, which side, name).
On submit the page POSTs to `/api/rsvp` and the server inserts a row into the
`rsvps` table in `data/rsvp.db`:

| column | meaning |
|---|---|
| `id` | auto-increment |
| `name` | guest name |
| `attendance` | `yes` / `no` |
| `persons` | number of people coming (0 when declining) |
| `side` | `groom`, `bride`, `groom,bride` or empty |
| `lang` | language used (`am`/`en`/`ru`) |
| `created_at` | ISO timestamp |

### API
| route | notes |
|---|---|
| `POST /api/rsvp` | public — saves one response (validated; `persons` clamped 1–10) |
| `GET /api/rsvps` | **admin only** — send header `x-admin-key: <key>` (or `?key=`). Returns all rows + `stats.totalPersons` |

## Admin page

Open `/admin.html`, enter the admin key. It shows:
- **Total guests attending** — the sum of `persons` across everyone who said yes,
- chips for total responses / attending / declined,
- a table of every response (newest first),
- **Refresh** and **Download CSV**.

The key is stored only in `sessionStorage` (cleared when the tab closes); "Lock"
clears it immediately.

## Backups & hosting

- All responses live in **`data/rsvp.db`** — copy that file to back them up.
  It is git-ignored so responses never get committed.
- The server must stay running to accept RSVPs. For real use, host it on any
  Node-capable host, or run it on an always-on machine and expose it.
- The admin key is a simple shared secret over plain HTTP — fine for a private
  link, but put it behind HTTPS if you publish it publicly.

## Re-convert HEIC photos
Requires `pip install pillow pillow-heif`. Convert new HEIC photos to
web-optimized `.jpg` into `assets/img/` (max 1920px wide).
