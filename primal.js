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
    if (window.console && console.debug) console.debug('[primal-analytics]', name, params);
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var label = a.getAttribute('data-cta');
    if (!label) {
      if (/leadconnectorhq\.com/.test(href)) label = 'book-demo';
      else if (/\/audit/.test(href)) label = 'run-audit';
      else return;
    }
    emit('cta_click', { cta: label, href: href, text: (a.textContent || '').trim().slice(0, 60) });
  }, true);

  var marks = [25, 50, 75, 100], fired = {};
  function onScroll() {
    var h = document.documentElement;
    var scrolled = h.scrollTop || document.body.scrollTop;
    var height = (h.scrollHeight - h.clientHeight) || 1;
    var pct = Math.min(100, Math.round((scrolled / height) * 100));
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

  emit('page_view', {});
})();
