/* ==========================================================================
   Seating chart — round tables on a floor plan + pointer drag & drop.
   Works with a mouse and with touch (pointer events, no HTML5 DnD).

   Drag a guest chip: pool -> table (seat), table -> table (move),
                      table -> pool  (unseat).
   Drag a table by its centre to reposition it.
   ========================================================================== */
'use strict';

(function () {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const floor    = $('#floor');
  const pool     = $('#pool');
  const TABLE_D  = 200;        // round-table diameter in px (matches css)
  const CHIP_R   = 0.5;        // chip ring radius as a fraction of the table size
  // footprint per shape — keep in step with admin.css
  const SHAPE = {
    circle: { w: 200, h: 200 },
    rect:   { w: 320, h: 160 },
  };
  const sizeOf = t => SHAPE[t.shape === 'rect' ? 'rect' : 'circle'];

  // If the seating markup isn't present (old cached admin.html), do nothing
  // rather than throwing — the rest of the admin page must keep working.
  if (!floor || !pool) {
    console.warn('seating markup not found — seating tab disabled');
    window.Seating = { render() {} };
    return;
  }

  /* ---------- zoom ---------------------------------------------------------- */
  const canvas   = $('#floor-canvas');
  const floorWrap= $('#floor-wrap');
  const FLOOR_W = 2600, FLOOR_H = 1800;   // keep in step with .floor in admin.css
  const ZOOM_MIN = 0.3, ZOOM_MAX = 2, ZOOM_STEP = 0.1;

  let zoom = 1;
  try { zoom = parseFloat(localStorage.getItem('seatZoom')) || 1; } catch { /* blocked storage */ }
  zoom = Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);

  function applyZoom(save = true) {
    floor.style.transform = `scale(${zoom})`;
    if (canvas) {
      canvas.style.width  = (FLOOR_W * zoom) + 'px';
      canvas.style.height = (FLOOR_H * zoom) + 'px';
    }
    const lvl = $('#zoom-level');
    if (lvl) lvl.textContent = Math.round(zoom * 100) + '%';
    const zi = $('#zoom-in'), zo = $('#zoom-out');
    if (zi) zi.disabled = zoom >= ZOOM_MAX - 1e-9;
    if (zo) zo.disabled = zoom <= ZOOM_MIN + 1e-9;
    if (save) { try { localStorage.setItem('seatZoom', String(zoom)); } catch { /* ignore */ } }
  }

  /* Zoom keeping a screen point steady (the cursor, or the viewport centre). */
  function setZoom(next, anchor) {
    const prev = zoom;
    zoom = Math.min(Math.max(+next.toFixed(2), ZOOM_MIN), ZOOM_MAX);
    if (zoom === prev) return;

    const wrapRect = floorWrap.getBoundingClientRect();
    const ax = anchor ? anchor.x - wrapRect.left : floorWrap.clientWidth  / 2;
    const ay = anchor ? anchor.y - wrapRect.top  : floorWrap.clientHeight / 2;
    // floor-space point currently under the anchor
    const fx = (floorWrap.scrollLeft + ax) / prev;
    const fy = (floorWrap.scrollTop  + ay) / prev;

    applyZoom();
    floorWrap.scrollLeft = fx * zoom - ax;
    floorWrap.scrollTop  = fy * zoom - ay;
  }

  $('#zoom-in') ?.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
  $('#zoom-out')?.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
  $('#zoom-level')?.addEventListener('click', () => setZoom(1));

  /* Fit: scale so every table is visible at once. */
  $('#zoom-fit')?.addEventListener('click', () => {
    const tables = window.Admin?.state.tables || [];
    if (!tables.length) { setZoom(1); return; }
    const maxX = Math.max(...tables.map(t => t.x + sizeOf(t).w)) + 40;
    const maxY = Math.max(...tables.map(t => t.y + sizeOf(t).h)) + 40;
    const z = Math.min(floorWrap.clientWidth / maxX, floorWrap.clientHeight / maxY, ZOOM_MAX);
    setZoom(Math.max(z, ZOOM_MIN));
    floorWrap.scrollLeft = floorWrap.scrollTop = 0;
  });

  /* Ctrl/⌘ + wheel zooms around the cursor. */
  floorWrap?.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), { x: e.clientX, y: e.clientY });
  }, { passive: false });

  applyZoom(false);

  /* ---------- render ------------------------------------------------------- */
  function render() {
    const A = window.Admin;
    if (!A) return;
    const { guests, tables } = A.state;

    /* --- floor plan --- */
    $('#floor-empty').hidden = tables.length > 0;
    // remove old tables (keep the empty-message node)
    $$('.table-circle', floor).forEach(el => el.remove());

    tables.forEach(t => {
      const seated = guests.filter(g => g.table_id === t.id);
      // .table-circle is the generic "table" class (also used for hit-testing);
      // .is-rect switches it to a rectangular footprint.
      const isRect = t.shape === 'rect';
      const el = document.createElement('div');
      el.className = 'table-circle' + (isRect ? ' is-rect' : '') +
                     (seated.length >= t.capacity ? ' full' : '');
      el.style.left = t.x + 'px';
      el.style.top  = t.y + 'px';
      el.dataset.tableId = t.id;

      const hub = document.createElement('div');
      hub.className = 'table-hub';
      hub.title = 'Drag to move · double-click the label to rename';

      // the main label IS the table name (falls back to the number)
      const label = document.createElement('span');
      label.className = 'table-no' + (t.name ? ' named' : '');
      label.textContent = t.name || t.number;
      label.title = 'Double-click to rename';
      label.addEventListener('dblclick', e => { e.stopPropagation(); editTableName(t, label); });
      hub.appendChild(label);

      const count = document.createElement('span');
      count.className = 'table-count';
      count.textContent = `${seated.length}/${t.capacity}`;
      hub.appendChild(count);
      el.appendChild(hub);

      const del = document.createElement('button');
      del.className = 'table-del';
      del.textContent = '×';
      del.title = 'Delete table';
      del.addEventListener('pointerdown', e => e.stopPropagation());
      del.addEventListener('click', () => deleteTable(t));
      el.appendChild(del);

      // seats: around the circle, or along the long edges of a rectangle
      seated.forEach((g, i) => {
        const chip = makeChip(g);
        chip.classList.add('seat-chip');
        if (isRect) {
          const perSide = Math.ceil(t.capacity / 2);
          const top = i < perSide;
          const idx = top ? i : i - perSide;
          const slots = top ? perSide : t.capacity - perSide;
          chip.style.left = (((idx + 0.5) / Math.max(slots, 1)) * 100) + '%';
          chip.style.top  = top ? '4%' : '96%';
        } else {
          const angle = (i / t.capacity) * 2 * Math.PI - Math.PI / 2;
          chip.style.left = (50 + Math.cos(angle) * CHIP_R * 100) + '%';
          chip.style.top  = (50 + Math.sin(angle) * CHIP_R * 100) + '%';
        }
        el.appendChild(chip);
      });

      // dragging the hub moves the whole table
      hub.addEventListener('pointerdown', e => startTableDrag(e, el, t));
      floor.appendChild(el);
    });

    /* --- unseated pool (right panel) --- */
    const q = A.state.search.trim().toLowerCase();
    const unseated = guests.filter(g => {
      if (g.table_id != null) return false;
      if (A.state.side !== 'all' && !(g.side || '').includes(A.state.side)) return false;
      if (q && !g.name.toLowerCase().includes(q)) return false;
      return true;
    });

    pool.innerHTML = '';
    $('#pool-empty').hidden = unseated.length > 0;
    unseated.forEach(g => pool.appendChild(makeChip(g)));

    const totalUnseated = guests.filter(g => g.table_id == null).length;
    $('#seat-counts').textContent =
      `${totalUnseated} unseated · ${guests.length} total`;
  }

  function makeChip(g) {
    const chip = document.createElement('div');
    chip.className = 'chip-guest' + (g.side ? ' side-' + g.side : '') +
                     (g.source === 'manual' ? ' manual' : '');
    // side icon + name (icon markup comes from admin.js, never from user input)
    if (g.side && window.Admin?.sideIcon) chip.appendChild(window.Admin.sideIcon(g.side));
    chip.appendChild(document.createTextNode(g.name));
    chip.title = g.name + (g.side ? ` — ${g.side === 'groom' ? "groom's" : "bride's"} side` : '') +
                 '\nDouble-click to rename';
    chip.dataset.guestId = g.id;
    chip.addEventListener('pointerdown', e => startGuestDrag(e, g));
    chip.addEventListener('dblclick', e => { e.stopPropagation(); editGuestName(g, chip); });
    return chip;
  }

  /* ---------- dragging a guest -------------------------------------------- */
  let drag = null;

  function startGuestDrag(e, guest) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();            // never move the table underneath

    const src = e.currentTarget;
    const rect = src.getBoundingClientRect();

    const ghost = src.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);

    drag = {
      type: 'guest', guest, ghost, src,
      dx: e.clientX - rect.left, dy: e.clientY - rect.top,
      target: null, moved: false,
    };
    src.classList.add('dragging');
    moveGhost(e);

    window.addEventListener('pointermove', onGuestMove);
    window.addEventListener('pointerup', onGuestUp, { once: true });
    window.addEventListener('pointercancel', onGuestUp, { once: true });
  }

  function moveGhost(e) {
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
    drag.ghost.style.top  = (e.clientY - drag.dy) + 'px';
  }

  function onGuestMove(e) {
    if (!drag) return;
    drag.moved = true;
    moveGhost(e);

    drag.ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    drag.ghost.style.visibility = '';

    const table = under?.closest('.table-circle');
    const inPool = !!under?.closest('.seat-panel');

    $$('.table-circle.drop-target').forEach(el => el.classList.remove('drop-target'));
    pool.classList.remove('drop-target');

    if (table) { table.classList.add('drop-target'); drag.target = { kind: 'table', id: +table.dataset.tableId, el: table }; }
    else if (inPool) { pool.classList.add('drop-target'); drag.target = { kind: 'pool' }; }
    else { drag.target = null; }
  }

  async function onGuestUp() {
    window.removeEventListener('pointermove', onGuestMove);
    if (!drag) return;
    const { guest, ghost, src, target, moved } = drag;

    ghost.remove();
    src.classList.remove('dragging');
    $$('.table-circle.drop-target').forEach(el => el.classList.remove('drop-target'));
    pool.classList.remove('drop-target');
    drag = null;

    if (!moved || !target) return;

    const A = window.Admin;
    if (target.kind === 'table') {
      if (guest.table_id === target.id) return;
      await patchGuest(guest, { table_id: target.id });
    } else if (target.kind === 'pool') {
      if (guest.table_id == null) return;
      await patchGuest(guest, { table_id: null });
    }
  }

  async function patchGuest(guest, body) {
    const A = window.Admin;
    const previous = guest.table_id;
    guest.table_id = body.table_id;      // optimistic
    recomputeStats();
    render();
    A.renderGuests();

    try {
      const res = await A.api(`/api/guests/${guest.id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      if (res.status === 409) {          // table full — revert and flash
        guest.table_id = previous;
        recomputeStats(); render(); A.renderGuests();
        // render() rebuilt the circles, so look the element up again —
        // the one captured before the drop is now detached.
        const el = $(`.table-circle[data-table-id="${body.table_id}"]`);
        el?.classList.add('flash-full');
        setTimeout(() => el?.classList.remove('flash-full'), 900);
        return;
      }
      if (!res.ok) throw new Error();
    } catch {
      guest.table_id = previous;
      recomputeStats(); render(); A.renderGuests();
    }
  }

  function recomputeStats() {
    const A = window.Admin, g = A.state.guests, s = A.state.stats;
    s.seated   = g.filter(x => x.table_id != null).length;
    s.unseated = g.filter(x => x.table_id == null).length;
  }

  /* ---------- dragging a table -------------------------------------------- */
  function startTableDrag(e, el, t) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();

    const startX = e.clientX, startY = e.clientY;
    const origX = t.x, origY = t.y;
    let x = origX, y = origY, moved = false;

    el.classList.add('moving');

    const size = sizeOf(t);
    function onMove(ev) {
      moved = true;
      // screen pixels -> floor coordinates (the floor is scaled by `zoom`)
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      x = Math.max(0, Math.min(origX + dx, FLOOR_W - size.w));
      y = Math.max(0, Math.min(origY + dy, FLOOR_H - size.h));
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
    }

    async function onUp() {
      window.removeEventListener('pointermove', onMove);
      el.classList.remove('moving');
      if (!moved) return;
      t.x = x; t.y = y;
      try {
        await window.Admin.api(`/api/tables/${t.id}`, {
          method: 'PATCH', body: JSON.stringify({ x, y }),
        });
      } catch { /* position stays local until next refresh */ }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  }

  /* ---------- add / delete tables ----------------------------------------- */
  async function addTable(shape) {
    try {
      const res = await window.Admin.api('/api/tables', {
        method: 'POST', body: JSON.stringify({ shape }),
      });
      if (res.ok) await window.Admin.reload();
    } catch { /* ignore */ }
  }
  $('#add-table-btn')?.addEventListener('click', () => addTable('circle'));
  $('#add-rect-btn') ?.addEventListener('click', () => addTable('rect'));

  /* ---------- fullscreen floor plan --------------------------------------- */
  const panel = $('#panel-seating');
  const fsBtn = $('#fs-btn');

  function setFullscreen(on) {
    panel.classList.toggle('fs', on);
    document.body.classList.toggle('fs-on', on);
    if (fsBtn) fsBtn.textContent = on ? '⛶ Exit fullscreen' : '⛶ Fullscreen';
    // the viewport changed size, so re-measure for scroll/fit
    requestAnimationFrame(() => applyZoom(false));
  }
  fsBtn?.addEventListener('click', () => setFullscreen(!panel.classList.contains('fs')));
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('fs')) setFullscreen(false);
  });

  /* Swap the label for an input, save on Enter/blur, cancel on Escape. */
  function editTableName(t, labelEl) {
    if (labelEl.querySelector('input')) return;
    const inp = document.createElement('input');
    inp.className = 'table-name-input';
    inp.value = t.name || '';
    inp.maxLength = 60;
    inp.placeholder = 'Table name';
    inp.addEventListener('pointerdown', e => e.stopPropagation());
    inp.addEventListener('click', e => e.stopPropagation());

    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const value = inp.value.trim();
      if (!save || value === (t.name || '')) { render(); return; }
      t.name = value;                                  // optimistic
      render();
      try {
        const res = await window.Admin.api(`/api/tables/${t.id}`, {
          method: 'PATCH', body: JSON.stringify({ name: value }),
        });
        if (!res.ok) throw new Error();
      } catch { window.Admin.reload(); }
    };

    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));

    labelEl.textContent = '';
    labelEl.appendChild(inp);
    inp.focus();
    inp.select();
  }

  /* Double-click a guest chip to rename that person. */
  function editGuestName(g, chip) {
    if (chip.querySelector('input')) return;
    const inp = document.createElement('input');
    inp.className = 'chip-name-input';
    inp.value = g.name;
    inp.maxLength = 120;
    ['pointerdown', 'click', 'dblclick'].forEach(ev =>
      inp.addEventListener(ev, e => e.stopPropagation()));

    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const value = inp.value.trim();
      if (!save || !value || value === g.name) { render(); return; }
      g.name = value;                                   // optimistic
      render();
      window.Admin.renderGuests();
      try {
        const res = await window.Admin.api(`/api/guests/${g.id}`, {
          method: 'PATCH', body: JSON.stringify({ name: value }),
        });
        if (!res.ok) throw new Error();
        await window.Admin.reload();                    // refresh root/other names
      } catch { window.Admin.reload(); }
    };

    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));

    chip.textContent = '';
    chip.appendChild(inp);
    inp.focus();
    inp.select();
  }

  async function deleteTable(t) {
    const seated = window.Admin.state.guests.filter(g => g.table_id === t.id).length;
    const msg = seated
      ? `Delete table ${t.number}? Its ${seated} guest(s) go back to the list.`
      : `Delete table ${t.number}?`;
    if (!confirm(msg)) return;
    try {
      const res = await window.Admin.api(`/api/tables/${t.id}`, { method: 'DELETE' });
      if (res.ok) await window.Admin.reload();
    } catch { /* ignore */ }
  }

  /* ---------- panel filter/search (shared state with the Guests tab) ------- */
  window.Admin?.wireSideFilter('#seat-side-filter', side => {
    window.Admin.state.side = side;
    window.Admin.syncFilterUI();
  });
  $('#seat-search')?.addEventListener('input', e => {
    window.Admin.state.search = e.target.value;
    window.Admin.syncFilterUI();
  });

  window.Seating = { render };

  // admin.js may have finished loading its data before this file ran
  if (window.Admin?.state.guests.length || window.Admin?.state.tables.length) render();
})();
