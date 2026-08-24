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

## Accounts (multi-user)

Each account has its own **guests, tables, seating and RSVPs** — they never see each
other's data. Sign in at `/admin.html` with a **username + secret key**.

- **Owner account** — created automatically on first run from `ADMIN_KEY`:
  username `rafmery` (change with the `OWNER_USERNAME` env var), display
  "Rafayel & Mery". All pre-existing data was assigned to it.
- **Adding users** — only the owner sees the **Users** tab. Create a user with a
  username, display name and secret key. Keys are stored **scrypt-hashed and can never
  be read back** — write it down when you create it (you can always reset it later).
- **Each user's invitation link** is `/u/<username>`. An RSVP submitted there lands in
  *that* user's guest list. The bare `/` belongs to the owner.
- **Account tab** — change your own key (this signs you out everywhere).
- Sessions last 30 days and survive a server restart. **Lock** ends the session.

> The invitation *design and text* is currently shared by all accounts — a second couple
> would still see the Rafayel & Mery page. Per-user invitation content is a separate
> feature.

## The admin page (`/admin.html`)

Tabs behind the login:

### 1. Guests — every individual person
An RSVP for a *party* is expanded into **one row per person**: "Anna" with 4 guests
becomes `Anna`, `Anna +1`, `Anna +2`, `Anna +3`. Each row can be **renamed inline**
(click the name, type, press Enter) — rename the `+1`s once you know who's coming.

- **Side** is shown as an icon — a blue **bow tie** for the groom's side, a pink
  **gown** for the bride's side (hover for the label). The side filter uses the
  same two icons.
- **Qty** shows how many people were added together under that name, so a group
  of 3 shows a highlighted **3** on each of its rows.
- **Source badge** — gold **Manual** (you typed it in) vs grey **Form** (came from the
  website RSVP).
- **+ Add guest** — add someone by hand (name + side + **People**). Setting
  People to 3 under "Rafayel" creates **Rafayel 1**, **Rafayel 2**, **Rafayel 3**
  as three separately seatable rows (max 20 at a time). A count of 1 keeps the
  bare name. RSVPs from the website use the same naming.
- **Filter** by groom's/bride's side, plus a name search.
- **×** removes a guest. Removed people are never re-created by the sync.

### 2. Seating — the floor plan
- **+ Add table** drops a new round table; each has a **number** and seats **12**.
- **Zoom** the floor plan with **− / + **, click the percentage to reset to 100%,
  or **Fit** to bring every table into view. **Ctrl + mouse wheel** zooms around
  the cursor. The zoom level is remembered between visits, and dragging stays
  accurate at any zoom.
- **Drag a table by its number** to move it. Positions are saved.
- **Drag a name** from the right-hand panel onto a table to seat them.
  Drag between tables to move, or back to the panel to unseat.
- The right panel shows the **unseated guests and the count**; the same
  side filter/search applies. Hover a table and click **×** to delete it —
  its guests return to the panel.
- **The 12-seat limit is enforced by the server**, so a full table rejects the drop
  and flashes red even if two people are editing at once.

### 3. Submissions — the raw RSVPs exactly as they were sent, plus **Download CSV**.

### Exporting the seating plan
Two buttons in the header, next to Download CSV, both organized **by table**
(one section/card per table, guests numbered 1., 2., 3. …):

- **Export all guests (Word)** — a `.docx` built server-side (zero dependencies —
  it's hand-assembled as a ZIP of XML parts, no library). One page per table with
  its name/number as the heading and a numbered guest list; anyone not yet seated
  is listed under a final "Unassigned" section so nobody is silently left out.
- **Export table cards (image)** — a single printable PNG sheet, a card per table
  (table name/number as the title, numbered guests below), styled in the wedding's
  cream/burgundy/gold palette — print and cut out for table-easel signs. Font size
  shrinks automatically for a full 12-seat table so the list always fits the card.

> **Guest counts never change by themselves.** Lowering an RSVP's guest count does
> **not** delete people who are already seated — remove them by hand, so a finished
> seating plan is never silently broken.

### Seating API (all require the admin key)
`GET /api/seating` · `POST /api/guests` · `PATCH|DELETE /api/guests/:id` ·
`POST /api/tables` · `PATCH|DELETE /api/tables/:id`

## Deploying (GitHub → live site)

> **GitHub Pages will not work for this app.** Pages serves static files only — it
> can't run `server.js` or SQLite, so the RSVP form and admin page would break.
> The app needs a Node host. Your GitHub repo is still the source: the host rebuilds
> automatically every time you push.

The repo already contains everything a host needs: `package.json` (`npm start`,
Node ≥ 22.5), a pinned `Dockerfile` (Node 22 — required for `node:sqlite`),
`.dockerignore` and `fly.toml`.

**Two things you MUST set on the host:**

| Env var | Value | Why |
|---|---|---|
| `DB_PATH` | `/data/rsvp.db` | must point at a **persistent volume**, or RSVPs are wiped on every redeploy |
| `ADMIN_KEY` | your own secret | don't ship the default |

### Option A — Railway (easiest, no CLI)
1. <https://railway.app> → **New Project → Deploy from GitHub repo** → pick
   `RafayelAndMery`. It auto-detects the Dockerfile and builds.
2. **Variables** tab → add `ADMIN_KEY` (your secret) and `DB_PATH` = `/data/rsvp.db`.
3. **Volumes** → add a volume mounted at `/data`.
4. **Settings → Networking → Generate Domain** → your public URL.

### Option B — Fly.io (uses `fly.toml`)
```bash
fly launch --no-deploy                     # edit `app` in fly.toml to a free name
fly volumes create rsvp_data --size 1 --region cdg
fly secrets set ADMIN_KEY=your-secret-here
fly deploy
```

After either: open `https://<your-url>/` for the invitation and
`https://<your-url>/admin.html` for the RSVP table. Both are HTTPS, so the admin
key isn't sent in the clear.

### Updating the live site
```bash
git add -A && git commit -m "update" && git push
```
Railway redeploys on push; for Fly run `fly deploy`.

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
