/* ==========================================================================
   Admin dashboard — RSVPs, guest list and the seating data.
   The admin key is kept in sessionStorage (cleared when the tab closes).

   Exposes window.Admin so js/seating.js can share the key, data and helpers.
   ========================================================================== */
'use strict';

const ADMIN_JS_VERSION = 17;      // bump with the ?v= in admin.html
console.log('admin.js v' + ADMIN_JS_VERSION + ' loaded');

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* Safe event binding: a missing element must never throw and take the rest of
   the script (including the login button) down with it. */
function on(sel, evt, fn) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) { console.warn('missing element:', sel); return null; }
  el.addEventListener(evt, fn);
  return el;
}

const gate    = $('#gate');
const dash    = $('#dash');
const gateMsg = $('#gate-msg');

/* Some browsers/privacy settings throw on sessionStorage access. That must never
   take the page down — fall back to an in-memory store. */
const memStore = {};
const store = {
  get(k)    { try { return sessionStorage.getItem(k); } catch { return memStore[k] ?? null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); }    catch { memStore[k] = v; } },
  remove(k) { try { sessionStorage.removeItem(k); }    catch { delete memStore[k]; } },
};

let sessionToken = store.get('session') || '';
let me = null;                     // { username, display_name, is_owner }
let lastRows = [];                 // raw RSVP rows (Submissions tab + CSV)

const state = { guests: [], tables: [], stats: {}, side: 'all', search: '' };

/* ----- API helper ---------------------------------------------------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'x-session': sessionToken,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    store.remove('session');
    sessionToken = '';
    showGate('Session expired — sign in again.');
    throw new Error('unauthorized');
  }
  return res;
}

/* ----- load everything ----------------------------------------------------- */
async function load() {
  const [rsvpRes, seatRes] = await Promise.all([
    api('/api/rsvps'),
    api('/api/seating'),
  ]);
  if (!rsvpRes.ok || !seatRes.ok) { showGate('Server error.'); return; }

  const rsvpData = await rsvpRes.json();
  const seatData = await seatRes.json();

  store.set('session', sessionToken);
  if (rsvpData.me) { me = rsvpData.me; applyIdentity(); }

  lastRows      = rsvpData.rows;
  state.guests  = seatData.guests;
  state.tables  = seatData.tables;
  state.stats   = seatData.stats;

  renderSubmissions(rsvpData);
  renderGuests();
  window.Seating?.render();

  gate.hidden = true;
  dash.hidden = false;
  gateMsg.textContent = '';          // don't leave a stale message behind the gate
  $('#key-input').value = '';
}

/* ----- Guests tab ---------------------------------------------------------- */
const SIDE_LABEL = { groom: 'Groom’s side', bride: 'Bride’s side' };

/* Side icons — bow tie for the groom's side, gown for the bride's side.
   These SVG strings are authored here, never built from user input. */
const SIDE_SVG = {
  groom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.4 9.2h3.2v5.6h-3.2z"/>' +
         '<path d="M10 12 2.6 7.4v9.2z"/><path d="M14 12l7.4-4.6v9.2z"/></svg>',
  bride: '<svg viewBox="0 0 24 24" aria-hidden="true">' +
         '<path d="M12 2c-1.2 1.6-1.8 3-1.8 4.3 0 1 .3 1.9.8 2.8L8.3 20h7.4l-2.7-10.9c.5-.9.8-1.8.8-2.8C13.8 5 13.2 3.6 12 2z"/></svg>',
};

/* Returns a <span class="side-ico"> with the icon + accessible label. */
function sideIcon(side) {
  const el = document.createElement('span');
  if (!side || !SIDE_SVG[side]) { el.className = 'side-ico none'; el.textContent = '—'; return el; }
  el.className = 'side-ico ' + side;
  el.innerHTML = SIDE_SVG[side];
  el.title = SIDE_LABEL[side];
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', SIDE_LABEL[side]);
  return el;
}

function visibleGuests() {
  const q = state.search.trim().toLowerCase();
  return state.guests.filter(g => {
    if (state.side !== 'all' && !(g.side || '').includes(state.side)) return false;
    if (q && !g.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

function setText(sel, val) { const el = $(sel); if (el) el.textContent = val; }

function renderGuests() {
  const s = state.stats;
  setText('#total-persons', s.total ?? 0);
  setText('#stat-total',    s.total ?? 0);
  setText('#stat-seated',   s.seated ?? 0);
  setText('#stat-unseated', s.unseated ?? 0);
  setText('#stat-groom',    s.groom ?? 0);
  setText('#stat-bride',    s.bride ?? 0);

  const body = $('#guests-body');
  if (!body) return;                    // stale markup — don't kill the page

  const list = visibleGuests();
  const tableById = Object.fromEntries(state.tables.map(t => [t.id, t.number]));
  body.innerHTML = '';

  // One row per PARTY here (the Seating tab still shows every person separately).
  const groups = groupGuests(list);

  setText('#filter-count',
    list.length === state.guests.length
      ? `${groups.length} entries · ${list.length} people`
      : `${groups.length} entries · ${list.length} of ${state.guests.length} people`);
  const emptyEl = $('#guests-empty');
  if (emptyEl) emptyEl.hidden = groups.length > 0;

  groups.forEach((grp, i) => {
    const members = grp.members;
    const n = members.length;
    const lead = members[0];

    const tr = document.createElement('tr');
    tr.dataset.groupId = grp.key;

    const td = (fill) => { const el = document.createElement('td'); fill(el); tr.appendChild(el); return el; };

    // drag handle — reorder the list
    td(el => {
      el.className = 'drag-cell';
      const h = document.createElement('span');
      h.className = 'drag-handle';
      h.textContent = '⠿';
      const filtered = state.side !== 'all' || state.search.trim();
      h.title = filtered ? 'Clear the filter/search to reorder' : 'Drag to reorder';
      if (filtered) h.classList.add('disabled');
      else h.addEventListener('pointerdown', e => startRowDrag(e, tr));
      el.appendChild(h);
    });

    td(el => el.textContent = i + 1);

    // name — editing a group renames every member ("Base 1", "Base 2", …)
    td(el => {
      el.className = 'name';
      const inp = document.createElement('input');
      inp.className = 'inline-edit';
      inp.value = grp.baseName;
      if (n > 1) inp.title = members.map(m => m.name).join(', ');
      inp.addEventListener('change', () => renameGroup(members, inp.value, inp));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      el.appendChild(inp);
    });

    // side — icon instead of text
    td(el => { el.className = 'side-cell'; el.appendChild(sideIcon(lead.side)); });

    // quantity — a compact −/+ stepper that adds or removes people in this party
    td(el => {
      el.className = 'qty-cell';
      const box = document.createElement('div');
      box.className = 'qty-stepper' + (n > 1 ? ' multi' : '');
      box.title = n > 1
        ? `${n} people: ${members.map(m => m.name).join(', ')}`
        : 'Single guest';

      const mk = (delta, label) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'qty-btn';
        b.textContent = label;
        b.disabled = grp.key.startsWith('solo:') ||
                     (delta < 0 && n <= 1) || (delta > 0 && n >= 20);
        b.title = delta > 0 ? 'Add a person to this party' : 'Remove the last person';
        b.addEventListener('click', () => resizeGroup(grp, n + delta, box));
        return b;
      };

      const val = document.createElement('span');
      val.className = 'qty-val';
      val.textContent = n;

      box.append(mk(-1, '−'), val, mk(1, '+'));
      el.appendChild(box);
    });

    td(el => {
      const b = document.createElement('span');
      b.className = 'badge ' + (lead.source === 'manual' ? 'manual' : 'form');
      b.textContent = lead.source === 'manual' ? 'Manual' : 'Form';
      el.appendChild(b);
    });

    // table(s) this party is sitting at
    td(el => {
      const nums = [...new Set(members.filter(m => m.table_id)
                                      .map(m => tableById[m.table_id] ?? '?'))].sort((a, b) => a - b);
      const seated = members.filter(m => m.table_id).length;
      if (!nums.length) { el.textContent = '—'; el.style.opacity = '.5'; return; }
      el.textContent = nums.length === 1 ? `Table ${nums[0]}` : `Tables ${nums.join(', ')}`;
      if (seated < n) {
        el.title = `${seated} of ${n} seated`;
        el.textContent += ` (${seated}/${n})`;
      }
    });

    td(el => {
      const btn = document.createElement('button');
      btn.className = 'row-del';
      btn.title = n > 1 ? `Remove all ${n} people` : 'Remove guest';
      btn.textContent = '×';
      btn.addEventListener('click', () => removeGroup(members, grp.baseName));
      el.appendChild(btn);
    });

    body.appendChild(tr);
  });
}

/* Collapse people into parties, preserving the order they appear in. */
function groupGuests(people) {
  const byKey = new Map();
  people.forEach(g => {
    const key = g.group_id || ('solo:' + g.id);
    if (!byKey.has(key)) byKey.set(key, { key, members: [] });
    byKey.get(key).members.push(g);
  });
  return [...byKey.values()].map(grp => {
    grp.members.sort((a, b) => (a.party_ix - b.party_ix) || (a.id - b.id));
    grp.baseName = baseNameOf(grp.members);
    return grp;
  });
}

/* Prefer the stored root_name; fall back to stripping the trailing number. */
function baseNameOf(members) {
  const stored = members[0].root_name;
  if (stored && stored.trim()) return stored.trim();
  if (members.length === 1) return members[0].name;
  const m = members[0].name.match(/^(.*?)[\s,]*\d+$/);
  return m && m[1].trim() ? m[1].trim() : members[0].name;
}

async function renameGuest(id, name, inputEl) {
  const trimmed = name.trim();
  if (!trimmed) { load().catch(() => {}); return; }
  try {
    const res = await api(`/api/guests/${id}`, { method: 'PATCH', body: JSON.stringify({ name: trimmed }) });
    if (!res.ok) throw new Error();
    const g = state.guests.find(x => x.id === id);
    if (g) g.name = trimmed;
    window.Seating?.render();
    inputEl?.classList.add('saved');
    setTimeout(() => inputEl?.classList.remove('saved'), 700);
  } catch { load().catch(() => {}); }
}

async function removeGuest(id, name) {
  if (!confirm(`Remove “${name}” from the guest list?`)) return;
  try {
    const res = await api(`/api/guests/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    await load();
  } catch { /* ignore */ }
}

/* Renaming a collapsed row renames the whole party. */
async function renameGroup(members, newBase, inputEl) {
  const base = newBase.trim();
  if (!base) { load().catch(() => {}); return; }
  if (members.length === 1) return renameGuest(members[0].id, base, inputEl);

  try {
    for (let i = 0; i < members.length; i++) {
      const res = await api(`/api/guests/${members[i].id}`, {
        method: 'PATCH', body: JSON.stringify({ name: `${base} ${i + 1}` }),
      });
      if (!res.ok) throw new Error();
    }
    inputEl?.classList.add('saved');
    setTimeout(() => inputEl?.classList.remove('saved'), 700);
    await load();
  } catch { load().catch(() => {}); }
}

/* The Qty stepper adds or removes people in that party. */
async function resizeGroup(grp, count, boxEl) {
  const cur = grp.members.length;
  count = Math.min(Math.max(count, 1), 20);
  if (count === cur) return;

  if (count < cur) {
    const going = grp.members.slice(count).map(m => m.name);
    if (!confirm(`Reduce “${grp.baseName}” to ${count}?\n\nThis removes:\n${going.map(x => '· ' + x).join('\n')}`)) return;
  }

  try {
    const res = await api('/api/group', {
      method: 'PATCH', body: JSON.stringify({ group_id: grp.key, count }),
    });
    if (!res.ok) throw new Error();
    boxEl?.classList.add('saved');
    await load();
  } catch { load().catch(() => {}); }
}

/* ---- drag a row to reorder the guest list ---- */
let rowDrag = null;

function startRowDrag(e, tr) {
  if (e.button != null && e.button !== 0) return;
  if (state.side !== 'all' || state.search.trim()) return;   // order is ambiguous when filtered
  e.preventDefault();
  rowDrag = { tr };
  tr.classList.add('row-dragging');
  window.addEventListener('pointermove', onRowMove);
  window.addEventListener('pointerup', onRowUp, { once: true });
  window.addEventListener('pointercancel', onRowUp, { once: true });
}

function onRowMove(e) {
  if (!rowDrag) return;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const over = under?.closest('#guests-body tr');
  if (!over || over === rowDrag.tr) return;
  const r = over.getBoundingClientRect();
  const after = e.clientY > r.top + r.height / 2;
  over.parentNode.insertBefore(rowDrag.tr, after ? over.nextSibling : over);
}

async function onRowUp() {
  window.removeEventListener('pointermove', onRowMove);
  if (!rowDrag) return;
  rowDrag.tr.classList.remove('row-dragging');
  rowDrag = null;

  const groups = $$('#guests-body tr').map(tr => tr.dataset.groupId).filter(Boolean);
  // renumber the visible # column straight away
  $$('#guests-body tr').forEach((tr, i) => { tr.children[1].textContent = i + 1; });
  try {
    await api('/api/guests/order', { method: 'PATCH', body: JSON.stringify({ groups }) });
    await load();
  } catch { load().catch(() => {}); }
}

/* Removing a collapsed row removes everyone in that party. */
async function removeGroup(members, label) {
  const n = members.length;
  const msg = n > 1
    ? `Remove all ${n} people in “${label}”?\n\n${members.map(m => '· ' + m.name).join('\n')}`
    : `Remove “${members[0].name}” from the guest list?`;
  if (!confirm(msg)) return;
  try {
    for (const m of members) {
      const res = await api(`/api/guests/${m.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    }
    await load();
  } catch { load().catch(() => {}); }
}

/* add a guest by hand */
on('#add-guest-form', 'submit', async (e) => {
  e.preventDefault();
  const name = $('#add-name').value.trim();
  const side = $('#add-side').value;
  const msg  = $('#add-msg');
  if (!name) { msg.textContent = 'Enter a name.'; return; }

  let count = parseInt($('#add-count')?.value, 10);
  if (!Number.isFinite(count) || count < 1) count = 1;
  count = Math.min(count, 20);

  msg.textContent = '';
  try {
    const res = await api('/api/guests', { method: 'POST', body: JSON.stringify({ name, side, count }) });
    if (!res.ok) throw new Error();
    $('#add-name').value = '';
    if ($('#add-count')) $('#add-count').value = 1;
    await load();
    msg.textContent = count > 1
      ? `${count} people added — “${name} 1” … “${name} ${count}”.`
      : `“${name}” added.`;
    setTimeout(() => { msg.textContent = ''; }, 3500);
  } catch { msg.textContent = 'Could not add.'; }
});

/* filter + search (shared with the seating panel) */
function wireSideFilter(rootSel, onChange) {
  $$(rootSel + ' .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$(rootSel + ' .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      onChange(btn.dataset.side);
    });
  });
}
wireSideFilter('#side-filter', side => { state.side = side; syncFilterUI(); });
on('#guest-search', 'input', e => { state.search = e.target.value; syncFilterUI(); });

function syncFilterUI() {
  // keep both filter UIs in step
  $$('#side-filter .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.side === state.side));
  $$('#seat-side-filter .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.side === state.side));
  const gs = $('#guest-search'), ss = $('#seat-search');
  if (gs && gs.value !== state.search) gs.value = state.search;
  if (ss && ss.value !== state.search) ss.value = state.search;
  renderGuests();
  window.Seating?.render();
}

/* ----- Submissions tab ----------------------------------------------------- */
function renderSubmissions({ stats, rows }) {
  $('#stat-responses').textContent = stats.responses;
  $('#stat-yes').textContent       = stats.yes;
  $('#stat-no').textContent        = stats.no;

  renderDeclined(rows);

  const body = $('#tbl-body');
  body.innerHTML = '';
  $('#empty-msg').hidden = rows.length > 0;

  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const attending = r.attendance === 'yes';
    const sides = (r.side || '').split(',').filter(Boolean);

    const cells = [
      rows.length - i,
      r.name,
      `<span class="pill ${attending ? 'yes' : 'no'}">${attending ? 'Yes' : 'No'}</span>`,
      attending ? r.persons : '—',
      null,                                   // side — icons, filled in below
      (r.lang || '').toUpperCase(),
      new Date(r.created_at).toLocaleString(),
    ];

    cells.forEach((val, idx) => {
      const td = document.createElement('td');
      if (idx === 4) {                        // side icons
        td.className = 'side-cell';
        if (!sides.length) td.appendChild(sideIcon(''));
        else sides.forEach(s => td.appendChild(sideIcon(s)));
      }
      else if (idx === 2) td.innerHTML = val; // pill markup (built above, not user input)
      else               td.textContent = val;// everything else escaped
      if (idx === 1) td.className = 'name';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

/* People who answered "No" — visible here since they never become seatable
   rows in the Guests / Seating tabs. */
function renderDeclined(rows) {
  const list = $('#declined-list');
  if (!list) return;
  const declined = rows.filter(r => r.attendance !== 'yes');

  setText('#declined-count', declined.length);
  $('#declined-empty').hidden = declined.length > 0;

  list.innerHTML = '';
  declined.forEach(r => {
    const sides = (r.side || '').split(',').filter(Boolean);
    const li = document.createElement('li');
    li.className = 'declined-row';

    const name = document.createElement('span');
    name.className = 'declined-name';
    name.textContent = r.name;
    li.appendChild(name);

    if (sides.length) sides.forEach(s => li.appendChild(sideIcon(s)));

    const meta = document.createElement('span');
    meta.className = 'declined-meta';
    meta.textContent = (r.lang || '').toUpperCase() + ' · ' + new Date(r.created_at).toLocaleDateString();
    li.appendChild(meta);

    list.appendChild(li);
  });
}

/* ----- Users tab (owner only) ---------------------------------------------- */
async function loadUsers() {
  const body = $('#users-body');
  if (!body) return;
  try {
    const res = await api('/api/users');
    if (!res.ok) return;
    const { users } = await res.json();
    body.innerHTML = '';
    users.forEach((u, i) => {
      const tr = document.createElement('tr');
      const td = (fill) => { const el = document.createElement('td'); fill(el); tr.appendChild(el); };

      td(el => el.textContent = i + 1);
      td(el => {
        el.className = 'name';
        el.textContent = u.username;
        if (u.is_owner) {
          const b = document.createElement('span');
          b.className = 'badge manual'; b.textContent = 'Owner';
          b.style.marginLeft = '8px';
          el.appendChild(b);
        }
      });
      td(el => el.textContent = u.display_name || '—');
      td(el => {
        const a = document.createElement('a');
        a.href = '/u/' + u.username;
        a.target = '_blank'; a.rel = 'noopener';
        a.className = 'user-link';
        a.textContent = '/u/' + u.username;
        el.appendChild(a);
      });
      td(el => el.textContent = u.rsvps);
      td(el => el.textContent = u.guests);
      td(el => el.textContent = u.tables);
      td(el => {
        el.style.whiteSpace = 'nowrap';
        const reset = document.createElement('button');
        reset.className = 'btn-ghost btn-mini';
        reset.textContent = 'Reset key';
        reset.addEventListener('click', () => resetUserKey(u));
        el.appendChild(reset);
        if (!u.is_owner) {
          const del = document.createElement('button');
          del.className = 'row-del';
          del.textContent = '×';
          del.title = 'Delete this user and all their data';
          del.style.marginLeft = '8px';
          del.addEventListener('click', () => deleteUser(u));
          el.appendChild(del);
        }
      });
      body.appendChild(tr);
    });
  } catch { /* handled by api() */ }
}

async function resetUserKey(u) {
  const key = prompt(`New secret key for “${u.username}”:`);
  if (key === null) return;
  if (key.trim().length < 4) { alert('Key must be at least 4 characters.'); return; }
  try {
    const res = await api('/api/users/' + u.id, { method: 'PATCH', body: JSON.stringify({ key: key.trim() }) });
    alert(res.ok ? `Key updated. “${u.username}” must sign in again.` : 'Could not update the key.');
  } catch { /* ignore */ }
}

async function deleteUser(u) {
  const typed = prompt(
    `Delete “${u.username}” and ALL their data?\n` +
    `${u.rsvps} RSVPs · ${u.guests} guests · ${u.tables} tables will be destroyed.\n\n` +
    `Type the username to confirm:`);
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== u.username) { alert('Name did not match — nothing deleted.'); return; }
  try {
    const res = await api('/api/users/' + u.id, { method: 'DELETE' });
    if (res.ok) await loadUsers(); else alert('Could not delete the user.');
  } catch { /* ignore */ }
}

on('#add-user-form', 'submit', async (e) => {
  e.preventDefault();
  const msg = $('#nu-msg');
  const username = $('#nu-username').value.trim().toLowerCase();
  const display  = $('#nu-display').value.trim();
  const key      = $('#nu-key').value.trim();
  msg.textContent = '';
  try {
    const res = await api('/api/users', {
      method: 'POST', body: JSON.stringify({ username, display_name: display, key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { msg.textContent = data.error || 'Could not add the user.'; return; }
    $('#nu-username').value = $('#nu-display').value = $('#nu-key').value = '';
    msg.textContent = `“${username}” created — note the key, it can't be shown again.`;
    await loadUsers();
  } catch { msg.textContent = 'Could not add the user.'; }
});

on('#my-key-form', 'submit', async (e) => {
  e.preventDefault();
  const msg = $('#my-key-msg');
  const key = $('#my-key').value.trim();
  if (key.length < 4) { msg.textContent = 'At least 4 characters.'; return; }
  try {
    const res = await api('/api/my-key', { method: 'PATCH', body: JSON.stringify({ key }) });
    if (!res.ok) { msg.textContent = 'Could not change the key.'; return; }
    $('#my-key').value = '';
    store.remove('session');
    sessionToken = '';
    showGate('Key changed — sign in with your new key.');
  } catch { msg.textContent = 'Could not change the key.'; }
});

/* ----- tabs ---------------------------------------------------------------- */
const TABS = ['guests', 'seating', 'submissions', 'users', 'account'];
$$('#tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#tabs .tab').forEach(b => b.classList.toggle('active', b === btn));
    TABS.forEach(name => {
      const p = $('#panel-' + name);
      if (p) p.hidden = name !== btn.dataset.tab;
    });
    // the seating tab uses the full window width
    document.body.classList.toggle('tab-seating', btn.dataset.tab === 'seating');
    if (btn.dataset.tab === 'seating') window.Seating?.render();
    if (btn.dataset.tab === 'users')   loadUsers();
  });
});

/* ----- CSV export ---------------------------------------------------------- */
function downloadCsv() {
  const head = ['id', 'name', 'attendance', 'persons', 'side', 'lang', 'created_at'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    head.join(','),
    ...lastRows.map(r => head.map(k => esc(r[k])).join(',')),
  ].join('\r\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rsvp-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ----- gate ---------------------------------------------------------------- */
function showGate(msg) {
  gate.hidden = false;
  dash.hidden = true;
  gateMsg.textContent = msg || '';
}

/* The login handlers are wired FIRST and never silently swallow a failure —
   a blank, unresponsive "Open" button is impossible to diagnose. */
/* Show who is signed in, and reveal the owner-only tab. */
function applyIdentity() {
  if (!me) return;
  setText('#who-title', me.display_name || me.username);
  setText('#who-sub', '@' + me.username + (me.is_owner ? ' · owner' : ''));
  setText('#acct-name', me.display_name || me.username);
  const link = $('#acct-link');
  if (link) link.textContent = 'Invitation link: ' + location.origin + '/u/' + me.username;
  const t = $('#tab-users');
  if (t) t.hidden = !me.is_owner;
}

async function submitKey() {
  const username = $('#user-input').value.trim().toLowerCase();
  const key      = $('#key-input').value.trim();
  if (!username) { gateMsg.textContent = 'Enter your username.'; return; }
  if (!key)      { gateMsg.textContent = 'Enter your secret key.'; return; }

  gateMsg.textContent = 'Checking…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, key }),
    });
    if (res.status === 401) { showGate('Wrong username or key.'); return; }
    if (!res.ok) { showGate('Server error (' + res.status + ').'); return; }

    const data = await res.json();
    sessionToken = data.token;
    me = data.user;
    store.set('session', sessionToken);
    applyIdentity();
    await load();
    if (!dash.hidden) gateMsg.textContent = '';
  } catch (err) {
    console.error('login failed:', err);
    showGate('Could not reach the server. Is it running? (node server.js)');
  }
}

// the gate is a <form>, so this covers both the button and the Enter key
on('#gate-form', 'submit', e => { e.preventDefault(); submitKey(); });
// belt-and-braces for older browsers where the form submit doesn't fire
on('#key-input', 'keydown', e => {
  if (e.key === 'Enter' || e.key === 'Return' || e.keyCode === 13) {
    e.preventDefault();
    submitKey();
  }
});

$('#refresh-btn').addEventListener('click', () => {
  load().catch(err => {
    if (err && err.message === 'unauthorized') return;
    console.error('refresh failed:', err);
    showGate('Lost connection to the server.');
  });
});
$('#csv-btn').addEventListener('click', downloadCsv);
$('#logout-btn').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST', headers: { 'x-session': sessionToken } }); } catch {}
  store.remove('session');
  sessionToken = '';
  me = null;
  $('#key-input').value = '';
  showGate('');
});

/* If a later script blows up (e.g. a stale cached file), say so on the gate
   instead of leaving a dead button. */
window.addEventListener('error', e => {
  if (dash.hidden) {
    gateMsg.textContent = 'Page failed to load properly — try a hard refresh (Ctrl+F5).';
    console.error('script error:', e.message);
  }
});

/* shared with js/seating.js */
window.Admin = {
  version: ADMIN_JS_VERSION,
  api,
  state,
  sideIcon,
  reload: () => load().catch(() => {}),
  renderGuests,
  syncFilterUI,
  visibleGuests,
  wireSideFilter,
};

/* auto-open if a key is already in this tab's session */
if (sessionToken) load().catch(() => showGate(''));
