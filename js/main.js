/* ==========================================================================
   Rafayel & Mery — wedding invitation logic
   ========================================================================== */

/* ----- CONFIG -------------------------------------------------------------
   Per-couple content (names, date, venues, photos) lives in js/weddings.js —
   edit it there, not here. This file only picks the right entry and wires it up.
   --------------------------------------------------------------------------- */

/* Which couple's invitation is this? /u/<username> selects one; "/" is the
   default. Same regex the RSVP submit uses to route the response (section 9). */
const WEDDING_SLUG = (location.pathname.match(/^\/u\/([a-z0-9-]+)\/?$/i) || [])[1];
const WEDDING = (function pickWedding() {
  const all = window.WEDDINGS || {};
  const found = all[(WEDDING_SLUG || '').toLowerCase()] || all[window.WEDDING_DEFAULT];
  if (found) return found;
  /* An account can exist without a weddings.js entry (or the file failed to
     load). Don't let that throw and take the whole page down — say so loudly
     and fall back to something renderable. */
  console.error('[weddings] no entry for "' + (WEDDING_SLUG || window.WEDDING_DEFAULT)
              + '" — add one to js/weddings.js');
  return { date: {}, cal: {}, maps: {}, slides: [] };
})();

/* Wedding date/time — used by the countdown + the calendar grid */
const WEDDING_DATE  = new Date(WEDDING.date.iso);
const WEDDING_YEAR  = WEDDING.date.year;
const WEDDING_MONTH = WEDDING.date.month;   // 0-based: 8 = September
const WEDDING_DAY   = WEDDING.date.day;

/* Map links for the two "How to get there" buttons */
const MAP_CEREMONY  = WEDDING.maps.ceremony;
const MAP_RECEPTION = WEDDING.maps.reception;

/* Max guests selectable in the RSVP stepper */
const MAX_PERSONS = 10;

/* "Add to calendar" event span — ceremony start to end of reception.
   Yerevan has no DST and is UTC+4 year-round, so 14:00–23:00 local
   converts to a fixed 10:00–19:00 UTC; no timezone library needed. */
const CAL_START_UTC = new Date(WEDDING.cal.startUTC);
const CAL_END_UTC   = new Date(WEDDING.cal.endUTC);

/* ----- small helpers ------------------------------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ----- apply the couple's photos, seal and page title ---------------------- */
(function applyWeddingContent() {
  if (WEDDING.title) document.title = WEDDING.title;

  const seal = $('#env-seal');
  if (seal && WEDDING.seal) seal.textContent = WEDDING.seal;

  const photo = $('#env-photo');
  if (photo && WEDDING.envelopeImg) photo.src = WEDDING.envelopeImg;

  // slides are positional: slot i takes WEDDING.slides[i]
  $$('.pbg-slide').forEach((el, i) => {
    const slide = (WEDDING.slides || [])[i];
    if (!slide) return;
    el.style.backgroundImage    = `url('${slide.src}')`;
    el.style.backgroundPosition = slide.position || 'center center';
  });
})();

/* ==========================================================================
   1. i18n
   ========================================================================== */
/* localStorage throws in some privacy modes — never let that break the page. */
const langStore = {
  get()  { try { return localStorage.getItem('lang'); } catch { return null; } },
  set(v) { try { localStorage.setItem('lang', v); }     catch { /* ignore */ } },
};

let currentLang = langStore.get() || 'am';

/* The shared strings from js/i18n.js with this couple's own strings (names,
   date, venues...) laid over the top. Anything a couple doesn't specify falls
   back to js/i18n.js. Always read texts through this, never window.I18N direct. */
function dictFor(lang) {
  const base = window.I18N[lang] || window.I18N.am;
  return { ...base, ...((WEDDING.i18n || {})[lang] || {}) };
}

function applyLang(lang) {
  if (!window.I18N[lang]) return;
  const dict = dictFor(lang);
  currentLang = lang;
  langStore.set(lang);
  document.documentElement.lang = dict.lang_html || lang;

  $$('[data-i18n]').forEach(el => {
    const val = dict[el.dataset.i18n];
    if (val == null) return;
    el.textContent = val;
  });
  // placeholder for the name input
  const nameInput = $('#guest-name');
  if (nameInput) nameInput.placeholder = dict.name_ph || '';
  // envelope photo alt — the couple's names in the current language
  const photo = $('#env-photo');
  if (photo) photo.alt = [dict.name_1, dict.name_2].filter(Boolean).join(' & ');

  // active flag state
  $$('.lang button').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));

  buildCalendar(dict);
}

$$('.lang button').forEach(btn =>
  btn.addEventListener('click', () => applyLang(btn.dataset.lang))
);

/* ==========================================================================
   2. Calendar  (November 2026, day 26 highlighted, Monday-start)
   ========================================================================== */
function buildCalendar(dict) {
  const grid = $('#cal-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // weekday headers Mon..Sun
  for (let i = 1; i <= 7; i++) {
    const h = document.createElement('div');
    h.className = 'wd';
    h.textContent = dict['wd_' + i] || '';
    grid.appendChild(h);
  }

  const year = WEDDING_YEAR, month = WEDDING_MONTH;
  const first = new Date(year, month, 1);
  // JS getDay(): 0=Sun..6=Sat  ->  Monday-start offset
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < offset; i++) {
    const b = document.createElement('div');
    b.className = 'day blank';
    grid.appendChild(b);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'day' + (d === WEDDING_DAY ? ' wed' : '');
    cell.textContent = d;
    grid.appendChild(cell);
  }
}

/* ==========================================================================
   3. Envelope open
   ========================================================================== */
const envelope = $('#envelope');
const envScreen = $('#envelope-screen');
let opened = false;

function openEnvelope() {
  if (opened) return;
  opened = true;
  envelope.classList.add('open');
  document.body.classList.remove('sealed');
  document.body.classList.add('opened');
  tryPlayMusic();               // first user gesture — allowed to start audio
  setTimeout(() => envScreen.classList.add('gone'), 1400);
}

envelope.addEventListener('click', openEnvelope);
envelope.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEnvelope(); }
});

/* ==========================================================================
   4. Background music
   ========================================================================== */
const audio = $('#bg-audio');
const musicBtn = $('#music-btn');
const MUSIC_START = 26;   // seconds — every start (first play, resume, loop
                          // repeat) cuts in here instead of at 0:00
let musicWanted = true;

function tryPlayMusic() {
  if (!musicWanted) return;
  audio.currentTime = MUSIC_START;
  audio.play().then(() => {
    musicBtn.classList.add('playing');
  }).catch(() => { /* autoplay blocked — will retry on the next user gesture */ });
}

// Best-effort attempt right when the page loads. Most browsers block audio
// with sound before any user interaction, so this usually fails silently —
// the guaranteed start is the envelope click below, which the browser always
// counts as a user gesture.
tryPlayMusic();

musicBtn.addEventListener('click', () => {
  if (audio.paused) {
    musicWanted = true;
    tryPlayMusic();
  } else {
    musicWanted = false;
    audio.pause();
    musicBtn.classList.remove('playing');
  }
});

// Manual loop (no native "loop" attribute on the <audio>): when the track
// finishes, jump back to MUSIC_START rather than 0:00 and keep playing.
audio.addEventListener('ended', () => { if (musicWanted) tryPlayMusic(); });

/* ==========================================================================
   5. Scroll reveal
   ========================================================================== */
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in-view'); });
}, { threshold: 0.18 });
$$('.reveal').forEach(el => io.observe(el));

/* ==========================================================================
   6. Page background slideshow — fixed behind the content, content scrolls
      over it (see .page-bg / .pbg-slide in styles.css).
   ========================================================================== */
(function pageBgSlideshow() {
  const slides = $$('.pbg-slide');
  if (slides.length < 2) return;
  let i = 0;
  setInterval(() => {
    slides[i].classList.remove('active');
    i = (i + 1) % slides.length;
    slides[i].classList.add('active');
  }, 6000);
})();

/* ==========================================================================
   7. Countdown
   ========================================================================== */
(function countdown() {
  const dEl = $('#cd-days'), hEl = $('#cd-hours'), mEl = $('#cd-mins'), sEl = $('#cd-secs');
  if (!dEl) return;
  const pad = n => String(n).padStart(2, '0');
  function tick() {
    let diff = Math.max(0, WEDDING_DATE - new Date());
    const days = Math.floor(diff / 86400000); diff -= days * 86400000;
    const hrs  = Math.floor(diff / 3600000);  diff -= hrs * 3600000;
    const mins = Math.floor(diff / 60000);     diff -= mins * 60000;
    const secs = Math.floor(diff / 1000);
    dEl.textContent = days;
    hEl.textContent = pad(hrs);
    mEl.textContent = pad(mins);
    sEl.textContent = pad(secs);
  }
  tick();
  setInterval(tick, 1000);
})();

/* ==========================================================================
   8. Map buttons
   ========================================================================== */
$('#map-ceremony')  && ($('#map-ceremony').href  = MAP_CEREMONY);
$('#map-reception') && ($('#map-reception').href = MAP_RECEPTION);

/* ==========================================================================
   8b. Add to calendar — downloads an .ics (Apple/Outlook/most Android
   calendar apps) with a built-in 1-day-before reminder alarm, so the guest's
   own calendar app notifies them the day before — no server/email needed.
   A "Google Calendar" link is offered alongside since Google Calendar's web
   app doesn't reliably import a clicked .ics file.
   ========================================================================== */
function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}
function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
/* RFC 5545: content lines over 75 octets must be folded (CRLF + a leading space). */
function icsFold(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75), rest = line.slice(75);
  while (rest.length > 0) { out += '\r\n ' + rest.slice(0, 74); rest = rest.slice(74); }
  return out;
}
function calEventText() {
  const dict = dictFor(currentLang);
  return {
    summary: `${dict.name_1} & ${dict.name_2} — ${dict.prog_title}`,
    description: `${dict.ceremony_title} ${dict.ceremony_time} — ${dict.ceremony_place}\n`
                + `${dict.reception_title} ${dict.reception_time} — ${dict.reception_place}`,
    location: dict.reception_place,
  };
}
function buildICS() {
  const { summary, description, location } = calEventText();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rafayel & Mery Wedding//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:rafmery-wedding-2026@visitor.local',
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(CAL_START_UTC)}`,
    `DTEND:${icsDate(CAL_END_UTC)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(location)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', `DESCRIPTION:${icsEscape(summary)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
function downloadICS() {
  const blob = new Blob([buildICS()], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'rafayel-mery-wedding.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function googleCalendarUrl() {
  const { summary, description, location } = calEventText();
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary,
    dates: `${icsDate(CAL_START_UTC)}/${icsDate(CAL_END_UTC)}`,
    details: description,
    location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
$('#add-to-calendar') && $('#add-to-calendar').addEventListener('click', downloadICS);
$('#add-to-gcal') && $('#add-to-gcal').addEventListener('click', (e) => {
  e.preventDefault();
  window.open(googleCalendarUrl(), '_blank', 'noopener');
});

/* ==========================================================================
   9. RSVP form -> /api/rsvp (stored in the database)
   ========================================================================== */
const form = $('#rsvp-form');
const sendBtn = $('#send-btn');
const formMsg = $('#form-msg');

/* --- guests stepper: only shown when the guest is attending -----------------
   The <input type="number"> (#persons-val) is the single source of truth —
   the − / + buttons and direct typing both read/write it, so they can never
   fall out of sync. */
const personsField = $('#persons-field');
const personsVal   = $('#persons-val');
const personsMinus = $('#persons-minus');
const personsPlus  = $('#persons-plus');

function getPersons() {
  let v = parseInt(personsVal.value, 10);
  if (!Number.isFinite(v)) v = 1;
  return Math.min(Math.max(v, 1), MAX_PERSONS);
}
function setPersons(v) {
  v = Math.min(Math.max(v, 1), MAX_PERSONS);
  personsVal.value = v;
  personsMinus.disabled = v <= 1;
  personsPlus.disabled  = v >= MAX_PERSONS;
}
personsMinus.addEventListener('click', () => setPersons(getPersons() - 1));
personsPlus .addEventListener('click', () => setPersons(getPersons() + 1));

// keep button enabled/disabled state live while typing, without clamping
// mid-keystroke (that would fight the caret / block deleting a digit)
personsVal.addEventListener('input', () => {
  const v = parseInt(personsVal.value, 10);
  personsMinus.disabled = Number.isFinite(v) && v <= 1;
  personsPlus.disabled  = Number.isFinite(v) && v >= MAX_PERSONS;
});
// clamp/normalize once the guest leaves the field
personsVal.addEventListener('blur', () => setPersons(getPersons()));
personsVal.addEventListener('keydown', e => { if (e.key === 'Enter') personsVal.blur(); });

// show/hide the stepper based on the attendance answer
$$('input[name="attendance"]').forEach(r =>
  r.addEventListener('change', () => { personsField.hidden = r.value !== 'yes'; })
);
setPersons(1);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dict = dictFor(currentLang);

  const attendance = form.querySelector('input[name="attendance"]:checked');
  const name = $('#guest-name').value.trim();
  // radio buttons — a guest is invited by one side
  const sideInput = form.querySelector('input[name="side"]:checked');

  formMsg.classList.remove('error');

  if (!attendance) { showMsg(dict.err_attend, true); return; }
  if (!name)       { showMsg(dict.err_name, true);   return; }

  const attending = attendance.value === 'yes';

  // /u/<username> decides whose guest list this RSVP joins; "/" = the owner
  const uMatch = location.pathname.match(/^\/u\/([a-z0-9-]+)\/?$/i);

  const payload = {
    name,
    attendance: attendance.value,               // 'yes' | 'no'
    persons:    attending ? getPersons() : 0,
    side:       sideInput ? sideInput.value : '',  // '' | 'groom' | 'bride'
    lang:       currentLang,
    user:       uMatch ? uMatch[1].toLowerCase() : undefined,
  };

  sendBtn.disabled = true;
  showMsg(dict.sending, false);

  try {
    const res = await fetch('/api/rsvp', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    form.reset();
    setPersons(1);
    personsField.hidden = true;
    showMsg(dict.success, false);
  } catch (err) {
    console.error('RSVP save failed:', err);
    showMsg(dict.error, true);
  } finally {
    sendBtn.disabled = false;
  }
});

function showMsg(text, isError) {
  formMsg.textContent = text;
  formMsg.classList.toggle('error', !!isError);
}

/* ==========================================================================
   init
   ========================================================================== */
applyLang(currentLang);
