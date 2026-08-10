/* PrimalSales.ai — lightweight, provider-agnostic analytics.
   Fires events to gtag / dataLayer / plausible IF present. No external calls, no dependencies.
   Events: page_view, cta_click {cta, href}, scroll_depth {depth}, section_view {section}. */
(function () {
  'use strict';
  var page = (location.pathname.replace(/\/$/, '').split('/').pop()) || 'index';

  function emit(name, params) {
    params = params || {};
    params.page = page;
    try { if (window.gtag) window.gtag('event', name, params); } catch (e) {}
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
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }
    if (!params.has('ref')) {
      var m = document.cookie.match(/(?:^|;\s*)primal_ref=([^;]+)/);
      if (m) { try { params.set('ref', decodeURIComponent(m[1])); } catch (e) {} }
    }
    if (!params.toString()) return;
    var links = document.querySelectorAll(
      'a[href^="https://go.primalsales.ai/"], a[href*="leadconnectorhq.com/widget/booking"]'
    );
    for (var i = 0; i < links.length; i++) {
      try {
        var url = new URL(links[i].href);
        params.forEach(function (v, k) {
          if (!url.searchParams.has(k)) url.searchParams.set(k, v);
        });
        links[i].href = url.toString();
      } catch (e) {}
    }
  }
  decorateBookingLinks();

  var ctaClicked = false;

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var label = a.getAttribute('data-cta');
    if (!label) {
      if (/leadconnectorhq\.com|go\.primalsales\.ai\//.test(href)) label = 'book-demo';
      else if (/\/audit/.test(href)) label = 'run-audit';
      else return;
    }
    ctaClicked = true;
    emit('cta_click', { cta: label, href: href, text: (a.textContent || '').trim().slice(0, 60) });
    /* 'Lead' is a STANDARD Meta event. Only standard events can be chosen as a
       campaign's optimisation goal or reported as a cost per result, so a
       custom event — however well named — leaves the ad account optimising for
       clicks. This is the click onto the booking calendar, not a confirmed
       booking; the booking itself completes on GHL's domain where this script
       cannot see it. Named honestly in the params so nobody reads it as a
       closed booking later. */
    if (label === 'book-demo') {
      try {
        if (window.fbq) window.fbq('track', 'Lead', { content_name: 'booking_calendar_opened', page: page });
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

  emit('page_view', {});
})();
