/* ==========================================================================
   Rafayel & Mery — wedding invitation logic
   ========================================================================== */

/* ----- CONFIG (edit these) ------------------------------------------------- */
/* Wedding date/time — 25 Sep 2026, 14:00 (used by the countdown + calendar) */
const WEDDING_DATE  = new Date('2026-09-25T14:00:00');
const WEDDING_YEAR  = 2026;
const WEDDING_MONTH = 8;   // 0-based: 8 = September
const WEDDING_DAY   = 25;

/* Map links for the two "How to get there" buttons */
const MAP_CEREMONY  = 'https://yandex.com/maps/-/CTviUFLt';  // Kecharis
const MAP_RECEPTION = 'https://yandex.com/maps/-/CTviYLpn';  // Palais Wedding Hall

/* Max guests selectable in the RSVP stepper */
const MAX_PERSONS = 10;

/* ----- small helpers ------------------------------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ==========================================================================
   1. i18n
   ========================================================================== */
/* localStorage throws in some privacy modes — never let that break the page. */
const langStore = {
  get()  { try { return localStorage.getItem('lang'); } catch { return null; } },
  set(v) { try { localStorage.setItem('lang', v); }     catch { /* ignore */ } },
};

let currentLang = langStore.get() || 'am';

function applyLang(lang) {
  const dict = window.I18N[lang];
  if (!dict) return;
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
let musicWanted = true;

function tryPlayMusic() {
  if (!musicWanted) return;
  audio.play().then(() => {
    musicBtn.classList.add('playing');
  }).catch(() => { /* no audio file yet, or blocked */ });
}

musicBtn.addEventListener('click', () => {
  if (audio.paused) {
    musicWanted = true;
    audio.play().then(() => musicBtn.classList.add('playing')).catch(() => {});
  } else {
    musicWanted = false;
    audio.pause();
    musicBtn.classList.remove('playing');
  }
});

/* ==========================================================================
   5. Scroll reveal
   ========================================================================== */
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in-view'); });
}, { threshold: 0.18 });
$$('.reveal').forEach(el => io.observe(el));

/* ==========================================================================
   6. Hero slideshow
   ========================================================================== */
(function slideshow() {
  const slides = $$('.hero .slide');
  if (slides.length < 2) return;
  let i = 0;
  setInterval(() => {
    slides[i].classList.remove('active');
    i = (i + 1) % slides.length;
    slides[i].classList.add('active');
  }, 5000);
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
   9. RSVP form -> /api/rsvp (stored in the database)
   ========================================================================== */
const form = $('#rsvp-form');
const sendBtn = $('#send-btn');
const formMsg = $('#form-msg');

/* --- guests stepper: only shown when the guest is attending --- */
const personsField = $('#persons-field');
const personsVal   = $('#persons-val');
const personsMinus = $('#persons-minus');
const personsPlus  = $('#persons-plus');
let persons = 1;

function renderPersons() {
  personsVal.textContent = persons;
  personsMinus.disabled = persons <= 1;
  personsPlus.disabled  = persons >= MAX_PERSONS;
}
personsMinus.addEventListener('click', () => { if (persons > 1)            { persons--; renderPersons(); } });
personsPlus .addEventListener('click', () => { if (persons < MAX_PERSONS)  { persons++; renderPersons(); } });

// show/hide the stepper based on the attendance answer
$$('input[name="attendance"]').forEach(r =>
  r.addEventListener('change', () => { personsField.hidden = r.value !== 'yes'; })
);
renderPersons();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dict = window.I18N[currentLang];

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
    persons:    attending ? persons : 0,
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
    persons = 1; renderPersons();
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
