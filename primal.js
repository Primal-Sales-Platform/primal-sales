/* PrimalSales.ai — lightweight, provider-agnostic analytics.
   Fires events to gtag / dataLayer / plausible IF present. No external calls, no dependencies.
   Events: page_view, cta_click {cta, href}, scroll_depth {depth},
   section_view {section}, engaged_time, page_exit, and the video set
   (video_start / video_progress / video_complete / video_exit). */
(function () {
  'use strict';
  var page = (location.pathname.replace(/\/$/, '').split('/').pop()) || 'index';

  function emit(name, params) {
    params = params || {};
    params.page = page;
    /* page_view is skipped for gtag for the same reason it is skipped for the
       pixel below: primal-consent.js configs GA with no send_page_view:false,
       so gtag('config', 'G-...') already sends a page_view the moment consent
       allows it. GA4's Views metric counts page_view EVENTS, so emitting a
       second one here doubled every visit. A campaign then reads twice the
       traffic it actually bought, which makes a bad conversion rate look half
       as bad and a good one look twice as good — and it is the denominator, so
       it is wrong in every direction at once. Every other event still carries
       `page`, so nothing is lost by letting GA4's own page_view stand alone. */
    try { if (window.gtag && name !== 'page_view') window.gtag('event', name, params); } catch (e) {}
    try { if (window.dataLayer) window.dataLayer.push(Object.assign({ event: name }, params)); } catch (e) {}
    try { if (window.plausible) window.plausible(name, { props: params }); } catch (e) {}
    /* Meta Pixel. Everything above reports to tools we READ; this is the one
       that decides where money goes. Without it the pixel only ever sends the
       PageView fired in the page head, so a paid campaign has no signal to
       optimise toward except link clicks — and it will faithfully deliver
       people who click things rather than people who book.
       page_view is skipped: the head snippet already fires the standard
       PageView, and a second one double-counts every visit. */
    try { if (window.fbq && name !== 'page_view') window.fbq('trackCustom', name, params); } catch (e) {}
    if (window.console && console.debug) console.debug('[primal-analytics]', name, params);
  }

  /* ONE definition of "this link opens a booking calendar", used by BOTH the
     attribution forwarding below and the Lead event further down, so the two
     can never disagree about which links count as booking links.
     Matches the same two hosts and the same trailing-slash-free "booking"
     path the forwarding selector uses (see its comment for why). */
  function isBookingHref(href) {
    return /^https:\/\/go\.primalsales\.ai\//.test(href) ||
           /leadconnectorhq\.com\/widget\/booking/.test(href) ||
           /^https:\/\/calendly\.com\//.test(href);
  }

  /* HOUSE SUPPRESSION. Every test booking Jared ran through the live calendar
     fired a real server-side Schedule, and Meta spent a month learning that a
     buyer looks like him: 5 of the account's 8 Schedule conversions in the 30
     days to 2026-09-09 were his own Aug 27 test runs, all credited to the
     retargeting campaign that shows him his own ads. Visit any page once with
     ?house=1 on each device you test from and this browser stops reporting
     conversions. cta_click, scroll and the rest still fire, because the point
     is to keep OUR runs out of the ad account, not to stop measuring them.
     Fails OPEN on a storage error: a real prospect's conversion must never be
     dropped because a browser refused localStorage. */
  var HOUSE_KEY = 'primal_house';
  function conversionsAllowed() {
    try {
      if (/[?&]house=1(&|$)/.test(location.search)) localStorage.setItem(HOUSE_KEY, '1');
      if (/[?&]house=0(&|$)/.test(location.search)) localStorage.removeItem(HOUSE_KEY);
      return localStorage.getItem(HOUSE_KEY) !== '1';
    } catch (e) { return true; }
  }

  /* ------------------------------------------------------------------ */
  /* ATTRIBUTION THAT SURVIVES AN INTERNAL CLICK                         */
  /*                                                                     */
  /* Everything below this file already forwards utm_* onto booking links */
  /* and into the Calendly widget — and every one of those reads          */
  /* location.search, which is empty the moment the reader clicks any     */
  /* internal link. /recovery alone carries eleven of them in its nav.    */
  /* So an ad drops somebody on /recovery?utm_campaign=X, they read       */
  /* /pricing on the way past, they book, and the booking arrives with no */
  /* campaign on it at all. The ad account then sees spend with no        */
  /* conversion and a conversion with no ad, which is the one comparison  */
  /* paid traffic exists to make.                                         */
  /*                                                                      */
  /* sessionStorage, deliberately, and not a cookie:                      */
  /*  - a visit is the right unit. The ad bought THIS visit; somebody who  */
  /*    comes back next week from a Google search must not be filed under  */
  /*    last week's campaign because our own store outlived the click.     */
  /*    Meta and GA run their own attribution windows; ours inventing a    */
  /*    longer one would overstate the channel that is already winning.    */
  /*  - it is same-origin and never transmitted. Nothing reaches a third   */
  /*    party that the visitor's own click was not already carrying there. */
  /*                                                                      */
  /* GATED ON CONSENT, because this is the one part of the chain that      */
  /* WRITES to the reader's device. See the note beside                   */
  /* window.primalMarketingAllowed in primal-consent.js: the Cookie Policy */
  /* counts session storage as a cookie and files marketing attribution    */
  /* under the off-switchable category. A refusal costs cross-page         */
  /* attribution and nothing else — the live query string still forwards,  */
  /* exactly as it did before this block existed.                          */
  /* ------------------------------------------------------------------ */

  /* A NAMED set, never the whole query string. The forwarding below still
     passes everything the current url carries, because a param the reader is
     literally looking at is theirs to hand on; but a param we PERSIST outlives
     the page that set it, and ?house=1 or ?v=b following somebody from page to
     page would be a different bug wearing this one's clothes. */
  var ATTRIBUTION_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'ref', 'fbclid', 'gclid'
  ];
  var ATTR_KEY = 'primal_attribution';

  function marketingStorageAllowed() {
    /* Read at call time, never cached at module scope: primal-consent.js
       blocks in <head> so the flag is already set, and Accept on the banner
       flips it mid-visit. Undefined means that file did not run at all, which
       is the one case where storing would be a promise nobody made. */
    return window.primalMarketingAllowed === true;
  }

  /* The landing page keeps its own name. `primal_page` (stamped further down)
     answers "which page hosted the calendar they booked from"; this answers
     "which page did the ad drop them on", and on any hop those are different
     pages. Overwriting one with the other would make a two-page test unreadable
     in whichever direction happened to lose. */
  function saveAttribution() {
    if (!marketingStorageAllowed()) return;
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var found = {}, any = false;
    for (var i = 0; i < ATTRIBUTION_KEYS.length; i++) {
      var v = q.get(ATTRIBUTION_KEYS[i]);
      if (v) { found[ATTRIBUTION_KEYS[i]] = v; any = true; }
    }
    /* Nothing on this url means this is a hop, not a new arrival — leave the
       store alone. Writing an empty object here would erase the campaign on
       the reader's second click, which is the exact failure being fixed. */
    if (!any) return;
    /* A url that DOES carry attribution replaces the store wholesale rather
       than merging into it. A second ad click is a new attribution event, and
       merging would hand campaign B's booking a source from campaign A. */
    found.primal_entry = page.replace(/\.html$/, '') + '-page';
    try { sessionStorage.setItem(ATTR_KEY, JSON.stringify(found)); } catch (e) {}
  }

  function storedAttribution() {
    if (!marketingStorageAllowed()) return null;
    try {
      var raw = sessionStorage.getItem(ATTR_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : null;
    } catch (e) { return null; }
  }

  /* THE ONE READER both the booking-link decorator and the Calendly widget
     use, so the two can never disagree about which campaign a booking belongs
     to. Live query wins every key it carries: the reader is on that url now,
     and a stale store must never overrule what the ad just said. */
  function attributionParams() {
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(); }
    var stored = storedAttribution();
    if (stored) {
      for (var k in stored) {
        if (Object.prototype.hasOwnProperty.call(stored, k) && !params.has(k)) {
          params.set(k, stored[k]);
        }
      }
    }
    return params;
  }

  saveAttribution();

  /* Booking-link attribution: forward the current page's query string
     (utm_*, ref, etc.) — plus the primal_ref first-party cookie when no
     ?ref is present — onto every booking link, so GHL's calendar receives
     the original attribution params. Params already on a link's href win.

     Matches BOTH hosts a GHL calendar can live on: go.primalsales.ai
     (funnel-hosted) and api.leadconnectorhq.com (the raw booking widget
     a calendar hands you). Campaign pages point at their own calendar,
     and a 15-minute audit call is not the same calendar as the demo, so
     matching a single path or a single host silently drops every utm_*
     the moment a campaign gets its own booking link. Paid traffic then
     arrives unattributed and the ad spend has nothing to optimise
     toward. The widget URL already carries styling params; we only ever
     add keys that aren't already present, so those survive untouched.

     The path match deliberately stops at "booking" with NO trailing
     slash: LeadConnector hands out both /widget/booking/<id> and
     /widget/bookings/<slug>, and a match on "/widget/booking/" silently
     skips every plural-form link. Swapping in a new calendar would then
     look fine on the page and quietly stop forwarding attribution. */
  function decorateBookingLinks() {
    /* attributionParams(), not location.search: on the reader's second page the
       query string is empty and every utm_* the ad paid for would be dropped
       here. See the attribution block above. */
    var params = attributionParams();
    if (!params.has('ref')) {
      var m = document.cookie.match(/(?:^|;\s*)primal_ref=([^;]+)/);
      if (m) { try { params.set('ref', decodeURIComponent(m[1])); } catch (e) {} }
    }
    /* WHICH DOOR the booking came through, stamped on every booking link.

       Without this, two landing pages selling the same offer to the same
       audience produce byte-identical booking URLs, so the one question a
       two-page test exists to answer — which page produced the people who
       actually booked — cannot be answered on our side at all. Verified
       2026-08-30: /recovery and /agencies both emitted
       `booking?utm_source=fb&utm_campaign=...` with nothing separating them.

       It is a SEPARATE param, not utm_source, deliberately. The challenge
       decorator below overwrites utm_source because the challenge only stores
       two fields and the door has to travel in one of them; it pays for that
       by losing fb-vs-ig. A booking link has no such constraint, so there is
       no reason to spend the platform attribution Ads Manager reads. Adding a
       field costs nothing and loses nothing.

       Value matches the challenge decorator's format (`recovery-page`) so the
       same door reads the same in both dashboards, and the extension is
       stripped for the same reason it is there: production serves /recovery
       while a direct hit on /recovery.html is still a real way in, and filing
       one door under two names is the split that guard already exists to stop. */
    if (!params.has('primal_page')) {
      params.set('primal_page', page.replace(/\.html$/, '') + '-page');
    }
    /* Runs even on an empty query string now. An organic reader who lands on
       one of the two pages and books is exactly the comparison being made;
       bailing early filed them as anonymous. */
    if (!params.toString()) return;
    var links = document.querySelectorAll(
      'a[href^="https://go.primalsales.ai/"], a[href*="leadconnectorhq.com/widget/booking"]'
    );
    for (var i = 0; i < links.length; i++) {
      try {
        if (!isBookingHref(links[i].href)) continue;
        var url = new URL(links[i].href);
        params.forEach(function (v, k) {
          if (!url.searchParams.has(k)) url.searchParams.set(k, v);
        });
        links[i].href = url.toString();
      } catch (e) {}
    }
  }
  decorateBookingLinks();

  /* ONE definition of "this link hands the reader to the Brittany challenge",
     for the same reason isBookingHref exists: the decorator below and any
     future reader of these links must never disagree about which ones count. */
  function isChallengeHref(href) {
    return /^https:\/\/app\.primalsales\.ai\/brittany/.test(href);
  }

  /* Challenge-link attribution: mark WHICH DOOR the reader came through.
     The challenge lives on a different host (app.primalsales.ai), so its own
     counter sees a bare visit with no idea whether this person was warmed up
     by a pre-sell page first or clicked an ad straight to it. Those are the
     two front doors being compared, and until now the warmed one arrived
     anonymous and got pooled with organic traffic — so the only question that
     matters ("which door produces people who actually take the call") could
     not be answered on our side at all.

     utm_source is OVERWRITTEN rather than forwarded, deliberately. The
     challenge only stores a source and a campaign, so the door has to travel
     in one of the two, and utm_campaign is the one that has to keep matching
     the ad account. The cost is real and worth stating: for this path we lose
     which platform the click came from (fb vs ig). That is still visible in
     Ads Manager, whereas the door is visible nowhere else.

     Everything else on the incoming query string is forwarded untouched, so
     the campaign name and any ref survive the hop.

     Unlike the booking decorator this runs even with an EMPTY query string:
     an organic reader who finds the coaching page and clicks through is still
     someone who came through that door, and that is worth knowing. */
  function decorateChallengeLinks() {
    /* attributionParams(), because the comment four lines up promises "the
       campaign name and any ref survive the hop" and location.search cannot
       keep that promise — it is empty on every page after the first. The
       utm_source overwrite below is untouched: the loop already skips that key
       and the door is set explicitly afterwards, so a stored source can never
       displace it. */
    var params = attributionParams();
    var links = document.querySelectorAll('a[href^="https://app.primalsales.ai/brittany"]');
    for (var i = 0; i < links.length; i++) {
      try {
        if (!isChallengeHref(links[i].href)) continue;
        var url = new URL(links[i].href);
        if (params) {
          params.forEach(function (v, k) {
            if (k !== 'utm_source' && !url.searchParams.has(k)) url.searchParams.set(k, v);
          });
        }
        /* The extension is stripped because production serves clean URLs
           (/coaching) while a direct hit on /coaching.html is still a real
           way in — and `page` carries whatever the path said. Leaving it
           would file the SAME door under two names, which is the exact
           split that already makes fb and FB two rows in the dashboard. */
        url.searchParams.set('utm_source', page.replace(/\.html$/, '') + '-page');
        links[i].href = url.toString();
      } catch (e) {}
    }
  }
  decorateChallengeLinks();

  var ctaClicked = false;
  var leadFired = false;

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    /* Decide "is this a booking link" from the DESTINATION, never from the
       label. The label is whatever data-cta says (hero-audit, final-audit,
       pricing-demo...), which is right for placement analytics and useless as
       a conversion test: gating the Lead event on label === 'book-demo' meant
       it only ever fired on the handful of buttons that had no data-cta at
       all. Every named button — 24 of the 27 booking CTAs on this site —
       silently sat out the one event the ad account optimises toward. */
    /* data-booking marks a CTA that scrolls to the calendar embedded on this
       page rather than navigating to one. Same intent, same event. */
    var isBooking = isBookingHref(a.href || href) || !!a.getAttribute('data-booking');
    var label = a.getAttribute('data-cta');
    if (!label) {
      if (isBooking) label = 'book-demo';
      else if (/\/audit/.test(href)) label = 'run-audit';
      else return;
    }
    ctaClicked = true;
    emit('cta_click', { cta: label, href: href, text: (a.textContent || '').trim().slice(0, 60) });
    /* 'Contact' is a STANDARD Meta event, which is the load-bearing part:
       only standard events can be chosen as a campaign's optimisation goal or
       reported as a cost per result, so a custom event — however well named —
       leaves the ad account optimising for clicks.

       This is the click ONTO the booking calendar. It was 'Lead' until
       2026-08-13, chosen when the booking completed on GHL's domain where
       nothing of ours could see it, so this was the furthest down the funnel
       anything could measure. The calendar carries the pixel now, which both
       removes that constraint and makes the old name actively harmful:
       'Lead' ALSO fires on the challenge page at call start, where the gate
       has already taken a name, work email, agency and team size — a real
       captured person. One name across two very different moments makes the
       Events Manager number mean nothing, and a campaign optimised toward it
       buys people who open a calendar and leave, reliably.

       The division, once the calendar is tagged:
         Contact  — reached the calendar (here)
         Lead     — we have their details (challenge page, call start)
         Schedule — they actually booked (calendar confirmation page)

       Deduped to one per page load on purpose: two clicks on two different
       CTAs is still one person heading to the calendar once, and counting it
       twice hands Meta a number nobody could reconcile against real bookings.

       Series break, worth knowing when reading history: the old 'Lead' count
       on this surface counts calendar OPENS, and before the destination-based
       fix above it counted them from only 3 of the 27 booking CTAs. */
    if (isBooking && !leadFired) {
      leadFired = true;
      try {
        if (window.fbq && conversionsAllowed()) window.fbq('track', 'Contact', { content_name: 'booking_calendar_opened', cta: label, page: page });
      } catch (e) {}
    }
  }, true);

  var marks = [25, 50, 75, 100], fired = {}, maxPct = 0;
  function onScroll() {
    var h = document.documentElement;
    var scrolled = h.scrollTop || document.body.scrollTop;
    var height = (h.scrollHeight - h.clientHeight) || 1;
    var pct = Math.min(100, Math.round((scrolled / height) * 100));
    if (pct > maxPct) maxPct = pct;
    for (var i = 0; i < marks.length; i++) {
      if (pct >= marks[i] && !fired[marks[i]]) { fired[marks[i]] = true; emit('scroll_depth', { depth: marks[i] }); }
    }
  }
  var t;
  window.addEventListener('scroll', function () {
    if (t) return; t = setTimeout(function () { t = null; onScroll(); }, 200);
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && en.intersectionRatio >= 0.5) {
          var s = en.target.getAttribute('data-track-section');
          if (s && !seen[s]) { seen[s] = true; emit('section_view', { section: s }); }
        }
      });
    }, { threshold: [0.5] });
    document.querySelectorAll('[data-track-section]').forEach(function (el) { io.observe(el); });
  }

  /* ---- VIDEO WATCH TIME -------------------------------------------
     How far into a video people actually get, which is the only way to
     know whether a hero video is earning its place above the fold or
     just pushing the CTA down.

     WATCHED TIME, NOT SCRUB POSITION. Milestones fire on time actually
     PLAYED, accumulated from timeupdate deltas, never on currentTime.
     Dragging the scrubber to the end would otherwise report as a 100%
     watch, and a video nobody watches would look like a video everybody
     finishes. Any jump larger than a normal tick is treated as a seek
     and contributes nothing, so the percentage can only ever be earned.

     Events: video_start, video_progress {pct 25|50|75|95}, video_complete,
     and video_exit for anyone who started and left part-way, which is most
     of them and is invisible from milestones alone.

     Label comes from data-video when set, otherwise the src filename, so a
     video added later is tracked without touching this file. */
  var videoStates = [];
  document.querySelectorAll('video').forEach(function (v) {
    var label = v.getAttribute('data-video');
    if (!label) {
      var src = v.currentSrc || v.getAttribute('src') || '';
      label = (src.split('/').pop() || 'video').replace(/\.[a-z0-9]+$/i, '') || 'video';
    }
    var st = { label: label, watched: 0, last: null, started: false, done: false, fired: {}, reported: false, duration: 0 };
    videoStates.push(st);
    if (v.duration && isFinite(v.duration)) st.duration = v.duration;
    v.addEventListener('loadedmetadata', function () {
      if (v.duration && isFinite(v.duration)) st.duration = v.duration;
    });

    function pct() {
      var d = v.duration;
      if (d && isFinite(d) && d > 0) st.duration = d;
      if (!st.duration) return 0;
      return Math.min(100, Math.round((st.watched / st.duration) * 100));
    }

    v.addEventListener('play', function () {
      st.last = v.currentTime;
      if (!st.started) { st.started = true; emit('video_start', { video: st.label }); }
    });
    /* A seek must not be counted as watching, and must not leave a stale
       `last` behind for the next tick to subtract from either. */
    v.addEventListener('seeking', function () { st.last = null; });
    v.addEventListener('seeked', function () { st.last = v.currentTime; });
    v.addEventListener('pause', function () { st.last = null; });

    v.addEventListener('timeupdate', function () {
      var now = v.currentTime;
      if (st.last !== null) {
        var d = now - st.last;
        /* timeupdate fires roughly every 250ms. 1.5s is generous enough to
           survive a stutter and tight enough that a real seek never lands
           inside it. */
        if (d > 0 && d < 1.5) st.watched += d;
      }
      st.last = now;
      var p = pct();
      [25, 50, 75, 95].forEach(function (mark) {
        if (p >= mark && !st.fired[mark]) {
          st.fired[mark] = true;
          emit('video_progress', { video: st.label, pct: mark, seconds: Math.round(st.watched) });
        }
      });
    });

    v.addEventListener('ended', function () {
      if (st.done) return;
      st.done = true; st.reported = true;
      emit('video_complete', { video: st.label, seconds: Math.round(st.watched), pct: pct() });
    });
  });

  /* Called from sendExit so a part-way watch is reported once, on the same
     signal every other exit metric uses. */
  function reportVideoExits() {
    videoStates.forEach(function (st) {
      if (!st.started || st.reported) return;
      st.reported = true;
      var p = st.duration ? Math.min(100, Math.round((st.watched / st.duration) * 100)) : null;
      emit('video_exit', { video: st.label, seconds: Math.round(st.watched), pct: p });
    });
  }

  /* How long they stayed, and how far they got before leaving.
     An average session of N seconds says nothing about WHERE those seconds
     went — and GA4 counts anything under 10s as an unengaged session, so the
     shortest visits (exactly the ones worth understanding on cold paid
     traffic) collapse into one undifferentiated bounce with no detail.
     Heartbeats mark survival past each threshold; one exit event carries the
     shape of the whole visit. Together they separate "never rendered",
     "read the headline and left", and "read halfway and still left" — three
     different problems with three different fixes. */
  var started = Date.now();
  var beats = [5, 15, 30, 60, 120], beatTimers = [];
  beats.forEach(function (s) {
    beatTimers.push(setTimeout(function () { emit('engaged_time', { seconds: s, max_scroll: maxPct }); }, s * 1000));
  });

  var exitSent = false;
  function sendExit() {
    if (exitSent) return;
    exitSent = true;
    for (var i = 0; i < beatTimers.length; i++) clearTimeout(beatTimers[i]);
    reportVideoExits();
    emit('page_exit', {
      seconds: Math.round((Date.now() - started) / 1000),
      max_scroll: maxPct,
      clicked_cta: ctaClicked ? 1 : 0,
    });
  }
  /* visibilitychange is the only exit signal mobile browsers fire reliably —
     'unload' is routinely skipped when a tab is backgrounded or the app is
     swiped away, which on paid social traffic is most of the exits. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendExit();
  });
  window.addEventListener('pagehide', sendExit);


  /* ------------------------------------------------------------------ */
  /* INLINE CALENDAR                                                     */
  /*                                                                     */
  /* Any page can host the booking calendar by dropping in a node with   */
  /* data-calendly-url. This finds it, loads Calendly's widget once, and */
  /* hands it the visitor's utm_* so a booking is still attributable to  */
  /* the ad that paid for it — Calendly's auto-init reads data-url as    */
  /* written and would drop them, which is why the widget is initialised */
  /* explicitly here instead.                                            */
  /*                                                                     */
  /* Then: Schedule. Calendly posts a message to the parent page when a  */
  /* booking completes, which is the first time this funnel has ever had */
  /* a conversion signal it owns. It fires once per page load, because a */
  /* re-render of the confirmation step is not a second booking.         */
  /* ------------------------------------------------------------------ */
  /* SCROLLING TO THE CALENDAR, AND WHY THE PLAIN ANCHOR IS NOT ENOUGH.
     href="#audit" makes the browser jump to wherever the section sits at the
     moment of the click. This page carries a video and several images above
     that point, and they finish loading afterwards: measured on a 1440x900
     desktop, the section moved 1463px further down after the jump and the
     browser does not re-scroll. The reader lands in the middle of the page
     looking at nothing, which is exactly what a redirect used to do to them.

     So: take the click, scroll to the calendar rather than the section (they
     asked for the number, the date picker is the thing they need on screen),
     and check twice afterwards that it is still where we put it. */
  function scrollToCalendar() {
    var wrap = document.querySelector('.rc-cal-wrap') ||
               document.querySelector('.cal-wrap') ||
               document.querySelector('[data-calendly-url]');
    if (!wrap) return false;
    var settle = function () {
      var want = parseFloat(getComputedStyle(wrap).scrollMarginTop) || 0;
      var top = wrap.getBoundingClientRect().top;
      if (Math.abs(top - want) > 40) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(settle, 600);
    setTimeout(settle, 1500);
    return true;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[data-booking]') : null;
    if (!a) return;
    /* Only take over the plain left-click. Cmd/ctrl/middle-click still do
       whatever the reader meant by them. */
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (scrollToCalendar()) e.preventDefault();
  });

  var calNode = document.querySelector('[data-calendly-url]');
  var scheduleFired = false;

  function calUtm() {
    /* Same reader as the booking-link decorator above, for the same reason:
       /recovery and / host the calendar inline, so the reader can arrive from
       an ad, read two more pages, come back and book — and location.search is
       long gone by then. */
    var q = attributionParams(), u = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      var v = q.get(k);
      if (v) u[k.replace(/_(\w)/g, function (m, c) { return c.toUpperCase(); })] = v;
    });
    return u;
  }

  if (calNode && calNode.getAttribute('data-calendly-url')) {
    var sc = document.createElement('script');
    sc.src = 'https://assets.calendly.com/assets/external/widget.js';
    sc.async = true;
    sc.onload = function () {
      try {
        window.Calendly.initInlineWidget({
          url: calNode.getAttribute('data-calendly-url') + '?hide_gdpr_banner=1',
          parentElement: calNode,
          prefill: {},
          utm: calUtm()
        });
        emit('calendar_loaded', {});
      } catch (e) { /* a failed widget must never take the page with it */ }
    };
    /* No onerror fallback link: the CTAs already scroll here, and a dead
       embed is visible to the reader in a way a swallowed redirect never was. */
    document.head.appendChild(sc);

    window.addEventListener('message', function (e) {
      if (!e || !e.data || typeof e.data.event !== 'string') return;
      if (e.data.event.indexOf('calendly.') !== 0) return;
      if (e.data.event === 'calendly.date_and_time_selected') emit('booking_time_selected', {});
      if (e.data.event === 'calendly.event_scheduled' && !scheduleFired) {
        scheduleFired = true;
        emit('booking_completed', {});
        try {
          if (window.fbq && conversionsAllowed()) window.fbq('track', 'Schedule', { content_name: page + '_audit', page: page });
        } catch (err) { /* never let a pixel error surface to somebody who just booked */ }
      }
    });
  }

  emit('page_view', {});
})();
