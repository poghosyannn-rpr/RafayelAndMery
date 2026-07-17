# Visitors — Wedding Invitation (Rafayel & Mery, 26.11.2026)

A single-page animated wedding invitation. Plain HTML/CSS/JS — no build step.

## Run locally
Open a terminal in this folder and run any static server, e.g.:

```
npx serve .
# or
python -m http.server 8000
```

Then open the shown URL (e.g. http://localhost:8000). Just double-clicking
`index.html` also works, but a server is recommended so fonts/images load cleanly.

## Structure
```
index.html        markup for every section
css/styles.css    palette (burgundy & blush-gold) + all animations
js/i18n.js        ALL texts, in Armenian / English / Russian — edit here
js/main.js        envelope open, language switch, calendar, countdown,
                  slideshow, music toggle, RSVP -> EmailJS  (+ CONFIG at top)
assets/img/       photos (already converted from your HEIC files)
assets/audio/     put your background track here as music.mp3
```

## Editing things

- **Texts** → `js/i18n.js`. Every string exists three times (am/en/ru). Placeholders
  in `[square brackets]` (venues/addresses) are meant to be filled in.
- **Wedding date/time, EmailJS keys, map links** → top of `js/main.js`
  (`WEDDING_DATE`, `MAP_CEREMONY`, `MAP_RECEPTION`, the `EMAILJS_*` constants).
- **Photos** → drop web images in `assets/img/` and reference them in `index.html`
  (search for `background-image` / the envelope `<img>`). To convert new HEIC
  photos, re-run the converter (see below).
- **Highlighted calendar day** → `buildCalendar()` in `main.js` highlights day `26`.
- **Background music** → add `assets/audio/music.mp3`. It starts when the guest
  opens the envelope (browsers block autoplay before a click) and the ♪ button
  toggles it.

## RSVP e-mail (EmailJS)
The form sends via EmailJS with these template variables:
`guest_name`, `attendance`, `invited_by`, `lang`, `to_email`.
Make sure your EmailJS **template** (`template_au42no4`) references those names,
e.g. in the template body:

```
Name: {{guest_name}}
Attending: {{attendance}}
Side: {{invited_by}}
Language: {{lang}}
```

Set the template's "To email" to `{{to_email}}` (or hard-code your address).

## Re-convert HEIC photos
Requires Python with `pillow` and `pillow-heif` (`pip install pillow pillow-heif`).
Point the script's `SRC` to the folder with new photos and run it; outputs land
in `assets/img/` as web-optimized `.jpg`.
