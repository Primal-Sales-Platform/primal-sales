/* PrimalSales.ai — consent gate for non-essential trackers.
 *
 * WHY THIS FILE EXISTS. Four third-party trackers used to load unconditionally
 * in the <head> of all nine pages: Google Analytics, the Meta Pixel,
 * Contentsquare session recording, and LeadConnector cross-site tracking.
 * HeyCatch product analytics was added later and gated the same way. The
 * published Cookie Policy said we used no marketing cookies at all. This file
 * is what makes the policy true: NOTHING non-essential loads except through
 * loadTrackers(), and loadTrackers() only runs when consent allows it.
 *
 * REGIME (founder decision, 2026-08-12 — "geo-aware"):
 *
 *   EU / EEA / UK / Switzerland / Canada  -> OPT-IN.  Nothing fires until the
 *     visitor clicks Accept. GDPR and Quebec Law 25 both want prior consent,
 *     and we are not marketing into those regions anyway, so the measurement
 *     cost is close to zero.
 *
 *   Everywhere else (i.e. the US, where the ads run) -> OPT-OUT. Trackers run
 *     as they always have, and a permanent "Your Privacy Choices" link lets
 *     anyone turn them off. That is what CPRA actually asks for, and it keeps
 *     Meta's optimisation signal whole.
 *
 * REGION DETECTION IS THE BROWSER'S OWN TIMEZONE. No IP lookup, because a
 * geo-IP call would mean shipping the visitor's address to a third party in
 * order to decide whether we are allowed to talk to third parties about them.
 * Intl is local, instant, and needs no network. It can be wrong if someone has
 * an unusual clock, so an UNREADABLE timezone is treated as strict — the error
 * lands on the side of asking rather than assuming.
 *
 * MUST LOAD FIRST, and must be the only place a tracker snippet lives. A
 * tracker pasted directly into a page's <head> again silently escapes all of
 * this, which is exactly the state this replaces.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'primal_consent';
  var VERSION = 1;

  /* ── the trackers, in one place ───────────────────────────────────────────
   * Each entry is a function that injects one tracker. Nothing here runs
   * until grantAndLoad() calls it. Adding a tracker means adding it HERE, not
   * in a page head — that is the whole point of the file.
   *
   * The Meta Pixel's <noscript> fallback image is deliberately NOT reproduced:
   * it fires without JavaScript, so it cannot be gated, and a no-JS visitor in
   * the EU would be tracked with no way to consent or refuse. Losing the
   * handful of no-JS pageviews is the correct trade.
   */
  var TRACKERS = {
    ga: function () {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=G-7T951Z81BH';
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      /* The linker is what makes this site and app.primalsales.ai ONE journey.
       * The challenge page lives on the app host, so without it GA starts a
       * fresh session there and reports our own app domain as a referring
       * site — one working funnel rendered as two unrelated ones, with the
       * ad that paid for it credited to neither.
       *
       * Only the SENDING side can decorate an outbound link, which is why
       * this half lives here and not only in the app. GA4's admin UI has the
       * same setting under "Configure your domains"; either is enough, both
       * is harmless, and neither breaks the pageview if it is ignored.
       *
       * go.primalsales.ai is listed EXPLICITLY even though GA matches these
       * entries by "contains", so 'primalsales.ai' already covered it — and
       * the _gl token on a real booking URL proves the outbound half works
       * today. It is named anyway because that host is where the booking
       * actually happens, and a list that leaves out the destination reads
       * like the destination was forgotten. The receiving half lives in the
       * GHL funnel's own head tracking box; without accept_incoming THERE,
       * this decoration is stamped onto a link nothing reads. */
      window.gtag('config', 'G-7T951Z81BH', {
        linker: {
          domains: ['primalsales.ai', 'app.primalsales.ai', 'go.primalsales.ai'],
          accept_incoming: true,
        },
      });
    },

    meta: function () {
      /* eslint-disable */
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
      }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      /* The second argument is advanced matching, and it was absent — which is
         why every event carried only what the pixel collects by itself. An id
         here applies to every event that follows, so one line lifts the whole
         account rather than one event name. Omitted entirely when there is no
         id rather than passed as null: the pixel treats a present-but-empty
         field as a value it should hash. */
      var eid = externalId();
      if (eid) window.fbq('init', '1823941828978061', { external_id: eid });
      else window.fbq('init', '1823941828978061');
      window.fbq('track', 'PageView');
    },

    contentsquare: function () {
      var s = document.createElement('script');
      s.defer = true;
      s.src = 'https://t.contentsquare.net/uxa/6de20d94bfe6c.js';
      document.head.appendChild(s);
    },

    /* LinkedIn Insight Tag. The plan is content -> audience -> retarget, aimed
     * at agencies running HubSpot, and LinkedIn is the only platform that can
     * target that person by role and company. A LinkedIn retargeting audience
     * CANNOT be backfilled — it only ever holds people who visited while the
     * tag was live — so every piece of content that runs before PARTNER_ID is
     * set builds an audience that does not exist.
     *
     * Partner ID 9515938, set 2026-08-13 from LinkedIn Campaign Manager
     * (Account Assets -> Insight Tag). The empty-string guard below stays: if
     * this is ever cleared or mistyped the tag does NOTHING and says so in the
     * console, because a half-configured tag firing against no account is
     * worse than an obviously absent one — it looks installed.
     *
     * LinkedIn's own snippet ends with a <noscript> <img> pixel. It is NOT
     * reproduced here, deliberately: a noscript image fires without any
     * JavaScript, so no consent gate can hold it, and a no-JS visitor in the
     * EU would be tracked with no way to consent or refuse. Same call already
     * made for the Meta pixel. */
    /* HeyCatch — product analytics for the public site. Autocapture only:
     * pageviews, clicks and route changes from init onward. There is no auth
     * and no payment on this static site, so no identity or business events
     * are wired here (the SDK's step 3 explicitly says to skip that when
     * there is nothing to report).
     *
     * WHY IT LIVES HERE AND NOT IN A PAGE <head>, which is what HeyCatch's
     * own install guide asks for: it is a non-essential tracker, which is the
     * exact class this file exists to gate. Pasting it into the head would
     * put the site back in the state the header above describes — a tracker
     * running before consent, and a Cookie Policy that no longer matches what
     * the site does. Section 2.3 of legal.html now lists HeyCatch; if this
     * entry is ever removed, remove it there too.
     *
     * WHAT THAT COSTS, honestly: in the US (opt-out, where the ads run) this
     * fires on page load like every other tracker, so nothing is lost. In the
     * EU/UK/CA (opt-in) nothing fires until Accept — correct, required, and
     * a region we do not advertise into. The one guide behaviour consent
     * delays is short-link forwarding, which is why the /:char redirect went
     * into vercel.json: a host rule forwards before any script runs and is
     * the guide's own preferred answer on static hosting anyway.
     *
     * The version is PINNED and must stay a plain x.y.z. A version with a "-"
     * in it is an internal build whose events never reach the dashboard.
     * Resolve a new one with `npm view @heycatch/sdk version` only. */
    heycatch: function () {
      var s = document.createElement('script');
      s.type = 'module';
      /* A module script with a static import, injected whole — the SDK acts
       * when the module evaluates, so there is no lazy chunk between us and
       * autocapture. `framework: 'web'` because this is hand-written static
       * HTML; frameworkVersion is omitted rather than guessed, per the guide
       * (absent is a countable unknown, a guess is wrong data forever). */
      s.textContent =
        "import { analytics } from 'https://esm.sh/@heycatch/sdk@0.7.0';\n" +
        "analytics.init({\n" +
        "  projectKey: 'hck_pk_orGO92n62nnTn4TjjKMTihiAJvst23IA',\n" +
        "  install: { framework: 'web', agent: 'claude-code' }\n" +
        "});";
      document.head.appendChild(s);
    },

    linkedin: function () {
      var PARTNER_ID = '9515938';
      if (!PARTNER_ID || !/^\d+$/.test(PARTNER_ID)) {
        if (window.console && console.warn) {
          console.warn('[consent] LinkedIn Insight Tag not active — set PARTNER_ID in primal-consent.js');
        }
        return;
      }
      window._linkedin_partner_id = PARTNER_ID;
      window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
      window._linkedin_data_partner_ids.push(PARTNER_ID);
      if (!window.lintrk) {
        window.lintrk = function (a, b) { window.lintrk.q.push([a, b]); };
        window.lintrk.q = [];
      }
      var li = document.createElement('script');
      li.async = true;
      li.src = 'https://snap.licdn.com/li.lms-analytics/insight.min.js';
      document.head.appendChild(li);
    },

    leadconnector: function () {
      var s = document.createElement('script');
      s.src = 'https://link.msgsndr.com/js/external-tracking.js';
      s.setAttribute('data-tracking-id', 'tk_5be8827d34fd4bc38838d85e55409e9d');
      document.head.appendChild(s);
    },
  };

  /* ── region ───────────────────────────────────────────────────────────────
   * Prefix-matching Europe/ is deliberately over-inclusive: it catches a few
   * non-EU countries (Moscow, Istanbul) along with the EEA and the UK. Asking
   * somebody we did not have to ask costs a banner click. Failing to ask
   * somebody we did have to ask is the thing with a penalty attached.
   */
  var CANADA_ZONES = [
    'America/Atikokan', 'America/Blanc-Sablon', 'America/Cambridge_Bay', 'America/Creston',
    'America/Dawson', 'America/Dawson_Creek', 'America/Edmonton', 'America/Fort_Nelson',
    'America/Glace_Bay', 'America/Goose_Bay', 'America/Halifax', 'America/Inuvik',
    'America/Iqaluit', 'America/Moncton', 'America/Montreal', 'America/Nipigon',
    'America/Pangnirtung', 'America/Rainy_River', 'America/Rankin_Inlet', 'America/Regina',
    'America/Resolute', 'America/St_Johns', 'America/Swift_Current', 'America/Thunder_Bay',
    'America/Toronto', 'America/Vancouver', 'America/Whitehorse', 'America/Winnipeg',
    'America/Yellowknife',
  ];

  function needsPriorConsent() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    if (!tz) return true;                        // unreadable -> ask, never assume
    if (tz.indexOf('Europe/') === 0) return true;
    if (tz.indexOf('Atlantic/') === 0) return true;   // Azores, Canaries, Faroe, Madeira
    if (CANADA_ZONES.indexOf(tz) !== -1) return true;
    return false;
  }

  /* ── Global Privacy Control ───────────────────────────────────────────────
   * GPC is a browser-level "do not sell or share" signal. Unlike the old DNT
   * header it is a recognised opt-out under the CPRA, so honouring it is not
   * optional for California visitors — and there is no way to know from here
   * who is Californian, so it is honoured for everyone. It counts as a
   * standing denial: nothing loads, and no banner nags them about a choice
   * their browser already made. An explicit Accept click still wins, because
   * a person overriding their own browser setting on this one site is making
   * a later and more specific choice than the setting.
   */
  function gpcDenied() {
    try { return window.navigator && window.navigator.globalPrivacyControl === true; }
    catch (e) { return false; }
  }

  /* ── stored choice ────────────────────────────────────────────────────────*/
  function readChoice() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || v.v !== VERSION) return null;
      return v.state === 'granted' || v.state === 'denied' ? v.state : null;
    } catch (e) { return null; }
  }

  function writeChoice(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: VERSION, state: state, ts: new Date().toISOString(),
      }));
    } catch (e) { /* private mode — the session still honours the click */ }
  }

  /* MARKETING-STORAGE PERMISSION, published as one global for primal.js.
   *
   * primal.js persists a visitor's utm_* across an internal page hop so the
   * booking link they eventually click still names the ad that paid for them.
   * That is storage, and the Cookie Policy already classes it: section 1 puts
   * "session storage" inside its definition of Cookies, and 2.4 describes
   * associating a visit with our records "so we know which marketing brought
   * you here" as a Marketing cookie — off-switchable, and dead in the strict
   * regions until somebody accepts. So the store has to answer to the same
   * decision the pixels answer to, or a published sentence stops being true.
   *
   * It is set HERE, inside loadTrackers, rather than re-derived from `choice`
   * and `strictRegion` further down: this line runs if and only if trackers
   * actually loaded, so the flag cannot drift from what the page really did,
   * and the banner's Accept button flips it mid-visit for free because Accept
   * calls this function. Forwarding utm_* from the CURRENT url onto a link the
   * visitor clicks is untouched by this and stays ungated — nothing is read
   * from or written to their device, so no policy line applies to it.
   *
   * Deliberately initialised to false above the decision: primal.js defers and
   * this file blocks in <head>, so the flag is always set before anything reads
   * it, and an undefined value would only mean this file failed to run at all. */
  window.primalMarketingAllowed = false;

  var loaded = false;

  /* A STABLE, ANONYMOUS ID FOR EVENT MATCHING.
     Every Meta event this site sends scored the same 6.1/10 on 2026-09-11,
     across all eleven event names, because every one of them carried the same
     identifiers and no more: _fbp, _fbc, the IP and the user agent. Event
     Match Quality scores the identifiers, so one number repeated eleven times
     is one cause, not eleven.
     The usual answer is advanced matching — hand the pixel a hashed email —
     and this site has no email to hand it. A reader on /recovery has given us
     nothing, and the booking happens inside a Calendly iframe we deliberately
     do not read. So the identifier we CAN add is one we make up: a random id
     that means nothing on its own, is never joined to a name or an address,
     and exists only so two events can be recognised as the same browser.
     Meta hashes it; we send the same value from the server once the booking
     carries it back, and the two halves match on something.
     CONSENT-GATED like every other store here, and for the same reason: it is
     written from inside the marketing loader, which does not run until
     marketing storage is allowed. A reader who refuses gets no id, which
     costs match quality and is the correct trade.
     Not an identifier in the legal sense we would need to disclose further:
     it is generated on the device, carries no personal data, and dies with
     the cookie. */
  var EID_KEY = 'primal_eid';
  var EID_DAYS = 365;
  function externalId() {
    if (window.primalMarketingAllowed !== true) return null;
    try {
      var m = document.cookie.match(/(?:^|;\s*)primal_eid=([^;]+)/);
      if (m && m[1]) return m[1];
      /* Lowercase hex, so the value needs no normalising before it is hashed.
         The pixel trims and lowercases an advanced-matching value before
         hashing it; a value that is ALREADY trimmed and lowercase hashes the
         same on both sides, which is the whole point of sending it. */
      var bytes = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      var id = '';
      for (var i = 0; i < bytes.length; i++) id += ('0' + bytes[i].toString(16)).slice(-2);
      document.cookie = EID_KEY + '=' + id + ';max-age=' + (EID_DAYS * 86400)
        + ';path=/;SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : '');
      return id;
    } catch (e) { return null; }
  }
  /* Read by primal.js, which rides it through to the booking so the server
     event can carry the same value. Null until consent, on purpose. */
  window.primalExternalId = externalId;
  function loadTrackers() {
    if (loaded) return;
    loaded = true;
    window.primalMarketingAllowed = true;
    for (var k in TRACKERS) {
      if (Object.prototype.hasOwnProperty.call(TRACKERS, k)) {
        try { TRACKERS[k](); } catch (e) { /* one tracker failing must not take the others */ }
      }
    }
  }

  /* Declining after the fact cannot un-ring the bell for the current page —
   * the scripts are already in memory. A reload is what actually stops them,
   * so a denial that follows a grant reloads. A denial with nothing loaded
   * (the opt-in regions) needs no reload and gets none. */
  function applyDenial(hadLoaded) {
    writeChoice('denied');
    if (hadLoaded) window.location.reload();
  }

  /* ── banner ───────────────────────────────────────────────────────────────*/
  var STYLE = [
    '.pc-bar{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#0d0d12;color:#e8e8ee;',
    'border-top:1px solid #2a2a35;padding:16px 20px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    'display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:center;box-shadow:0 -6px 24px rgba(0,0,0,.35)}',
    '.pc-bar p{margin:0;max-width:720px;flex:1 1 320px}',
    '.pc-bar a{color:#8fb7ff;text-decoration:underline}',
    '.pc-actions{display:flex;gap:10px;flex:0 0 auto}',
    '.pc-btn{cursor:pointer;border-radius:8px;padding:10px 18px;font-size:14px;font-weight:600;border:1px solid #3a3a48;',
    'background:transparent;color:#e8e8ee;font-family:inherit}',
    '.pc-btn:hover{border-color:#5a5a68}',
    '.pc-btn--primary{background:#6366f1;border-color:#6366f1;color:#fff}',
    '.pc-btn--primary:hover{background:#5457e0}',
    '@media(max-width:640px){.pc-bar{padding:14px 16px}.pc-actions{width:100%}.pc-btn{flex:1 1 0}}',
  ].join('');

  function injectStyle() {
    if (document.getElementById('pc-style')) return;
    var el = document.createElement('style');
    el.id = 'pc-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  function closeBanner() {
    var el = document.getElementById('pc-bar');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /* strict = the visitor is in an opt-in region and nothing has loaded yet, so
   * this is a first-visit ask. Otherwise it is the choices panel behind the
   * footer link, and since that panel is now the ONLY way an opt-out-region
   * visitor ever sees this thing, it has to state the situation they are
   * actually in: somebody who switched tracking off last week and comes back
   * to check must not be told "you can turn them off". */
  function showBanner(strict) {
    if (document.getElementById('pc-bar')) return;
    injectStyle();
    var running = loaded;   // non-strict only: is anything on right now?

    var bar = document.createElement('div');
    bar.id = 'pc-bar';
    bar.className = 'pc-bar';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-live', 'polite');
    bar.setAttribute('aria-label', 'Cookie choices');

    var copy = document.createElement('p');
    copy.innerHTML = strict
      ? 'We use cookies for analytics, advertising and session recording. We won\'t turn any of them on until you say yes. See our <a href="/legal#cookies">Cookie Policy</a>.'
      : running
        ? 'We use cookies for analytics, advertising and session recording. You can turn them off for this browser at any time. See our <a href="/legal#cookies">Cookie Policy</a>.'
        : 'Analytics, advertising and session-recording cookies are switched off for this browser. See our <a href="/legal#cookies">Cookie Policy</a>.';

    var actions = document.createElement('div');
    actions.className = 'pc-actions';

    /* no = deny, yes = grant, always. Only the wording and which one is
     * highlighted change — and the highlighted one is whichever leaves them
     * where they already are, so the panel never pushes a visitor who came
     * here specifically to opt out. */
    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'pc-btn' + (!strict && !running ? ' pc-btn--primary' : '');
    no.textContent = strict ? 'Decline' : (running ? 'Turn them off' : 'Keep them off');

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'pc-btn' + (strict || running ? ' pc-btn--primary' : '');
    yes.textContent = strict ? 'Accept' : (running ? 'Keep them on' : 'Turn them back on');

    var hadLoaded = loaded;
    no.addEventListener('click', function () { closeBanner(); applyDenial(hadLoaded); });
    yes.addEventListener('click', function () { writeChoice('granted'); loadTrackers(); closeBanner(); });

    actions.appendChild(no);
    actions.appendChild(yes);
    bar.appendChild(copy);
    bar.appendChild(actions);

    function attach() { document.body.appendChild(bar); }
    if (document.body) attach();
    else document.addEventListener('DOMContentLoaded', attach);
  }

  /* ── the decision ─────────────────────────────────────────────────────────*/
  var choice = readChoice();
  var strictRegion = needsPriorConsent();

  if (choice === 'granted') {
    loadTrackers();
  } else if (choice === 'denied') {
    /* nothing loads, and no banner nags them about it */
  } else if (gpcDenied()) {
    /* their browser already said no — treat it as a denial, ask nothing */
  } else if (strictRegion) {
    showBanner(true);                 // ask BEFORE anything runs
  } else {
    /* US and everywhere else: opt-out, and NO first-visit bar. CPRA asks for a
     * persistent opt-out LINK, which every page footer carries; it does not ask
     * for a banner. Founder decision 2026-08-12: paid traffic lands on these
     * pages, so a bar across the fold costs conversions to satisfy a rule that
     * does not exist. The link is the mechanism, and the Cookie Policy
     * describes exactly that — it promises a link, never a banner. */
    loadTrackers();
  }

  /* "Your Privacy Choices" — the persistent opt-out entry point CPRA asks for.
   * Exposed globally AND wired to any [data-privacy-choices] element, so the
   * footer link works on a page that has already dismissed the banner. */
  window.primalPrivacyChoices = function () { showBanner(strictRegion && !loaded); };

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    while (t && t !== document.body) {
      if (t.hasAttribute && t.hasAttribute('data-privacy-choices')) {
        ev.preventDefault();
        window.primalPrivacyChoices();
        return;
      }
      t = t.parentNode;
    }
  });
})();
