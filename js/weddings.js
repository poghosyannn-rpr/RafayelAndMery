/* ==========================================================================
   WEDDINGS — one entry per couple.  THIS IS THE FILE YOU EDIT to add a couple.

   The whole site (design, animations, RSVP form, admin) is shared; only the
   content below differs per couple. The key is the account's username, so the
   invitation at  /u/<username>  picks up that couple's entry, and the bare "/"
   uses WEDDING_DEFAULT.

   To add a couple:
     1. Create their account in Admin -> Users (the username is the key here).
     2. Copy a block below, change the content, drop their photos in assets/img/.
     3. Nothing else — main.js wires it up automatically.

   Notes
     - `date.month` is 0-BASED (0 = January, 10 = November) because it feeds
       new Date(year, month, ...) for the calendar grid.
     - `cal.startUTC/endUTC` drive the "Add to calendar" .ics. Yerevan is UTC+4
       with no DST, so local 14:00 -> 10:00Z and 23:00 -> 19:00Z, year-round.
     - Image paths must start with "/" — the page is also served at /u/<name>,
       where a relative path would resolve against /u/ and 404.
     - Bump the ?v= on an image URL whenever you replace the file but keep the
       name: server.js serves images with Cache-Control: max-age=86400.
     - `i18n` holds ONLY the couple-specific keys. Everything else (form labels,
       weekday names, countdown labels, info text...) is shared and lives in
       js/i18n.js. Anything omitted here falls back to js/i18n.js.
   ========================================================================== */
window.WEDDINGS = {

  /* ---------------------------------------------------------------- rafmery */
  rafmery: {
    title: 'Ռաֆայել & Մերի — 25.09.26',
    seal:  'R&M',                       // initials on the envelope's wax seal
    date:  { iso: '2026-09-25T14:00:00', year: 2026, month: 8, day: 25 },
    cal:   { startUTC: '2026-09-25T10:00:00Z', endUTC: '2026-09-25T19:00:00Z' },
    maps:  {
      groomHome: 'https://yandex.com/maps/-/CTT0YQpt',   // Groom's home
      brideHome: 'https://yandex.com/maps/-/CTT0444u',   // Bride's home
      ceremony:  'https://yandex.com/maps/-/CTviUFLt',   // Kecharis
      reception: 'https://yandex.com/maps/-/CTviYLpn',   // Palais Wedding Hall
    },
    envelopeImg: '/assets/img/IMG_2787.JPG?v=5',
    slides: [
      { src: '/assets/img/2026-07-26 14.02.17.jpg', position: 'center center' },
      { src: '/assets/img/IMG_1198.JPG',            position: 'center 15%'    },
      { src: '/assets/img/IMG_1994.jpg',            position: 'center center' },
    ],
    i18n: {
      am: {
        name_1: 'Rafayel', name_2: 'Mery', date: '25.09.26',
        cal_month:       'Սեպտեմբեր 2026',
        groom_home_time: '11:00',
        bride_home_time: '13:00',
        ceremony_time:   '14:00',
        ceremony_place:  'Կեչառիս վանական համալիր',
        reception_time:  '17:30',
        reception_place: 'Palais Wedding Hall',
        rsvp_deadline:   'Սպասում ենք Ձեր պատասխանին մինչև 18.09.2026թ.',

      },
      en: {
        name_1: 'Rafayel', name_2: 'Mery', date: '25.09.26',
        cal_month:       'September 2026',
        groom_home_time: '11:00',
        bride_home_time: '13:00',
        ceremony_time:   '14:00',
        ceremony_place:  'Kecharis Monastery',
        reception_time:  '17:30',
        reception_place: 'Palais Wedding Hall',
        rsvp_deadline:   'We look forward to your reply by 18.09.2026.',
      },
      ru: {
        name_1: 'Рафаел', name_2: 'Мери', date: '25.09.26',
        cal_month:       'Сентябрь 2026',
        groom_home_time: '11:00',
        bride_home_time: '13:00',
        ceremony_time:   '14:00',
        ceremony_place:  'Монастырь Кечарис',
        reception_time:  '17:30',
        reception_place: 'Palais Wedding Hall',
        rsvp_deadline:   'Ждём вашего ответа до 18.09.2026.',
      },
    },
  },

  /* -------------------------------------------------------------------- gor */
  gorarm: {
    title: 'Գոռ & Արմինե — 19.11.26',
    seal:  'G&A',                       // initials on the envelope's wax seal
    date:  { iso: '2026-11-19T14:00:00', year: 2026, month: 11, day: 19 },
    cal:   { startUTC: '2026-11-19T10:00:00Z', endUTC: '2026-11-19T19:00:00Z' },
    maps:  {
      groomHome: 'https://yandex.com/maps/-/CTT05ZjM',   // Groom's home
      brideHome: 'https://yandex.com/maps/-/CTT05ZjM',   // Bride's home
      ceremony:  'https://yandex.com/maps/-/CTTUNJ82',   // Hayravanq
      reception: 'https://yandex.com/maps/-/CTviYLpn',   // Palais Hall
    },
    envelopeImg: '/assets/img/gor/g1.jpg',
    slides: [
      { src: '/assets/img/gor/g1.jpg', position: 'center center' },
      { src: '/assets/img/gor/g2.jpg', position: 'center center' },
      { src: '/assets/img/gor/g3.jpg', position: 'center center' },
    ],
    i18n: {
      am: {
        name_1: 'Gor', name_2: 'Armine', date: '19.11.26',
        cal_month:       'Նոյեմբեր 2026',
        groom_home_time: '11:00',
        bride_home_time: '13:00',
        ceremony_time:   '14:00',
        ceremony_place:  'Հայրավանք',
        reception_time:  '17:30',
        reception_place: 'Palais Hall',
        rsvp_deadline:   'Սպասում ենք Ձեր պատասխանին մինչև 12.11.2026թ.',
      },
      en: {
        name_1: 'Gor', name_2: 'Armine', date: '19.11.26',
        cal_month:       'November 2026',
        groom_home_time: '11:00',
        bride_home_time: '13:00',
        ceremony_time:   '14:00',
        ceremony_place:  'Hayravank Monastery',
        reception_time:  '17:30',
        reception_place: 'Palais Hall',
        rsvp_deadline:   'We look forward to your reply by 12.11.2026.',
      },
      ru: {
        name_1: 'Гор', name_2: 'Армине', date: '19.11.26',
        cal_month:       'Ноябрь 2026',
        groom_home_time: '11:00',
        bride_home_time: '13:00',
        ceremony_time:   '14:00',
        ceremony_place:  'Монастырь Айраванк',
        reception_time:  '17:30',
        reception_place: 'Palais Hall',
        rsvp_deadline:   'Ждём вашего ответа до 12.11.2026.',
      },
    },
  },

  /* -------------------------------------------------------------------- gor & */
  gorgor: {
    title: 'Գոռ &  — 16.10.26',
    seal:  'G&',                       // initials on the envelope's wax seal
    date:  { iso: '2026-10-16T14:00:00', year: 2026, month: 10, day: 16 },
    cal:   { startUTC: '2026-11-19T10:00:00Z', endUTC: '2026-10-16T19:00:00Z' },
    maps:  {
      ceremony:  'https://yandex.com/maps/-/CTviUFLt',   // Kecharis
      reception: 'https://yandex.com/maps/-/CTTWzF41',   // Adana Complex
    },
    /* PLACEHOLDER PHOTOS — the rings-on-bouquet macro, no faces in frame.
       Replace all four paths once Gor & Armine's own photos are added. */
    envelopeImg: '/assets/img/2026-07-26 14.02.17.jpg',
    slides: [
      { src: '/assets/img/2026-07-26 14.02.17.jpg', position: 'center center' },
      { src: '/assets/img/2026-07-26 14.02.17.jpg', position: 'center center' },
      { src: '/assets/img/2026-07-26 14.02.17.jpg', position: 'center center' },
    ],
    i18n: {
      am: {
        name_1: 'Gor', name_2: '', date: '16.10.26',
        cal_month:       'հոկտեմբեր 2026',
        ceremony_time:   '14:00',
        ceremony_place:  'Կեչառիս վանական համալիր',
        reception_time:  '17:30',
        reception_place: 'Adana complex',
        rsvp_deadline:   'Սպասում ենք Ձեր պատասխանին մինչև 06.10.2026թ.',
      },
      en: {
        name_1: 'Gor', name_2: '', date: '16.10.26',
        cal_month:       'October 2026',
        ceremony_time:   '14:00',
        ceremony_place:  'Kecharis Monastery',
        reception_time:  '17:30',
        reception_place: 'Adana complex',
        rsvp_deadline:   'We look forward to your reply by 06.10.2026.',
      },
      ru: {
        name_1: 'Гор', name_2: '', date: '16.10.26',
        cal_month:       'Октябрь 2026',
        ceremony_time:   '14:00',
        ceremony_place:  'Монастырь Кечарис',
        reception_time:  '17:30',
        reception_place: 'Adana complex',
        rsvp_deadline:   'Ждём вашего ответа до 06.10.2026.',
      },
    },
  }

};

/* Which couple the bare "/" shows. */
window.WEDDING_DEFAULT = 'rafmery';
