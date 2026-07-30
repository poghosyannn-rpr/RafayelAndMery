/* ==========================================================================
   Admin dashboard — fetches stored RSVPs and shows the guest totals.
   The admin key is kept in sessionStorage (cleared when the tab closes).
   ========================================================================== */
'use strict';

const $ = (s) => document.querySelector(s);

const gate    = $('#gate');
const dash    = $('#dash');
const gateMsg = $('#gate-msg');

let adminKey = sessionStorage.getItem('adminKey') || '';
let lastRows = [];

/* ----- load ---------------------------------------------------------------- */
async function load() {
  const res = await fetch('/api/rsvps', { headers: { 'x-admin-key': adminKey } });

  if (res.status === 401) {
    sessionStorage.removeItem('adminKey');
    adminKey = '';
    showGate('Wrong key — try again.');
    return;
  }
  if (!res.ok) { showGate('Server error (' + res.status + ').'); return; }

  const data = await res.json();
  sessionStorage.setItem('adminKey', adminKey);
  render(data);

  gate.hidden = true;
  dash.hidden = false;
}

/* ----- render -------------------------------------------------------------- */
function render({ stats, rows }) {
  lastRows = rows;

  $('#total-persons').textContent  = stats.totalPersons;
  $('#stat-responses').textContent = stats.responses;
  $('#stat-yes').textContent       = stats.yes;
  $('#stat-no').textContent        = stats.no;

  const body = $('#tbl-body');
  body.innerHTML = '';
  $('#empty-msg').hidden = rows.length > 0;

  const sideLabel = { groom: 'Groom', bride: 'Bride', '': '—' };

  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const attending = r.attendance === 'yes';
    const side = (r.side || '')
      .split(',').filter(Boolean)
      .map(s => sideLabel[s] || s).join(', ') || '—';

    const cells = [
      rows.length - i,
      r.name,
      `<span class="pill ${attending ? 'yes' : 'no'}">${attending ? 'Yes' : 'No'}</span>`,
      attending ? r.persons : '—',
      side,
      (r.lang || '').toUpperCase(),
      new Date(r.created_at).toLocaleString(),
    ];

    cells.forEach((val, idx) => {
      const td = document.createElement('td');
      if (idx === 2) td.innerHTML = val;     // the pill markup (built above, not user input)
      else           td.textContent = val;   // everything else escaped
      if (idx === 1) td.className = 'name';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

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

$('#key-btn').addEventListener('click', () => {
  adminKey = $('#key-input').value.trim();
  if (!adminKey) { gateMsg.textContent = 'Enter the key.'; return; }
  gateMsg.textContent = '';
  load().catch(() => showGate('Could not reach the server.'));
});

$('#key-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#key-btn').click();
});

$('#refresh-btn').addEventListener('click', () => load().catch(() => {}));
$('#csv-btn').addEventListener('click', downloadCsv);
$('#logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('adminKey');
  adminKey = '';
  $('#key-input').value = '';
  showGate('');
});

/* auto-open if a key is already in this tab's session */
if (adminKey) load().catch(() => showGate(''));
