/**
 * The ad's campaign must still be on the booking link after the reader
 * clicks something.
 *
 * Every attribution reader in primal.js used to start from location.search,
 * which is empty on every page after the first. /recovery alone carries
 * eleven internal nav links. So an ad dropped somebody on
 * /recovery?utm_campaign=X, they read /pricing on the way past, they booked,
 * and the booking arrived with no campaign on it — spend with no conversion
 * on one side of Ads Manager and a conversion with no ad on the other.
 *
 * A source grep cannot prove this. The claim is a SEQUENCE — land, hop, then
 * look at the href the reader would actually click — so this drives a real
 * browser over the real files and reads the real attributes.
 *
 * It also pins the half that must NOT happen: in a strict-consent region with
 * nothing accepted, the store stays empty and the hop loses attribution,
 * because the Cookie Policy files marketing storage as off-switchable and
 * dead until accepted. Cross-page attribution is the thing consent costs
 * here; the live query string still forwards either way.
 *
 * It also pins the other half of getting a booking counted right: ONE booking
 * must be ONE conversion. A Calendly workflow forwards every booking on this
 * calendar into GoHighLevel, which posts it to our own webhook, which sends a
 * server-side Schedule. That payload carries none of Calendly's own ids, so
 * the two sides have no value in common and no shared event_id — which means
 * the page must not send a Schedule of its own.
 *
 * Run: node scripts/check-attribution-chain.mjs   (exits 1 on a violation)
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  if (!path.extname(rel)) rel += '.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
}

/* The booking href a reader on this page would actually click. Covers both
   shapes the site uses: a direct link to the GHL calendar, and the inline
   Calendly embed's node (whose utm_* travel through the widget config, read
   separately below). */
const bookingHrefs = () =>
  [...document.querySelectorAll('a[href^="https://go.primalsales.ai/"], a[href*="leadconnectorhq.com/widget/booking"]')]
    .map((a) => a.href);

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function newPage(timezoneId) {
  const ctx = await browser.newContext({ timezoneId });
  /* Third-party trackers are irrelevant to the chain and would make the run
     depend on the network. The consent DECISION still runs untouched, which is
     the only part of that file this check cares about. */
  /* Everything off this machine is blocked, so the run cannot depend on the
     network and cannot hang on a third party. The ONE exception is Calendly's
     widget, which is STUBBED rather than aborted: /recovery and the homepage
     book through the inline embed, so the config primal.js hands
     initInlineWidget IS the booking attribution on those two pages, and an
     aborted script would leave the most important path unobserved. */
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('calendly.com/assets/external/widget.js')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'window.Calendly={initInlineWidget:function(c){window.__calCfg=c;}};',
      });
    }
    if (url.startsWith('http://127.0.0.1:')) return route.continue();
    return route.abort();
  });
  return ctx;
}

const AD = '?utm_source=fb&utm_medium=paid&utm_campaign=recovery-sept&utm_content=ghosted-creative&fbclid=ABC123';

/* ── 1. permissive region: the chain has to hold across a hop ───────────── */
{
  const ctx = await newPage('America/New_York');
  const page = await ctx.newPage();

  await page.goto(base + '/recovery.html' + AD, { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/hubspot-audit.html', { waitUntil: 'domcontentloaded' });
  const hopped = await page.evaluate(bookingHrefs);
  /* SAY IT OUT LOUD WHEN THERE IS NOTHING TO READ. Every check below reads the
     first booking link on the hop page, and pages keep moving to an inline
     embed — /recovery, then the homepage, then seven more on 2026-09-10. When
     the last off-site link goes, these checks would each fall to an
     'x.invalid' placeholder and fail with a confusing message about a campaign
     name. This one says the real thing: the decorator has no subject left, and
     whoever moved that page needs to repoint this file, not debug it. */
  check('the hop page still carries a booking link to decorate', hopped.length > 0, `found ${hopped.length}`);
  check('page after the hop has booking links', hopped.length > 0, `found ${hopped.length}`);

  const u = new URL(hopped[0] || 'https://x.invalid/');
  check('utm_source survives the hop', u.searchParams.get('utm_source') === 'fb', u.searchParams.get('utm_source'));
  check('utm_campaign survives the hop', u.searchParams.get('utm_campaign') === 'recovery-sept', u.searchParams.get('utm_campaign'));
  check('utm_content survives the hop', u.searchParams.get('utm_content') === 'ghosted-creative', u.searchParams.get('utm_content'));
  check('fbclid survives the hop', u.searchParams.get('fbclid') === 'ABC123', u.searchParams.get('fbclid'));
  check('primal_entry names the landing page', u.searchParams.get('primal_entry') === 'recovery-page', u.searchParams.get('primal_entry'));
  check('primal_page still names the CURRENT page', u.searchParams.get('primal_page') === 'hubspot-audit-page', u.searchParams.get('primal_page'));

  /* A second ad click REPLACES rather than merges: campaign B's booking must
     never carry campaign A's source. */
  await page.goto(base + '/agencies.html?utm_source=li&utm_campaign=agency-oct', { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/hubspot-audit.html', { waitUntil: 'domcontentloaded' });
  const second = new URL((await page.evaluate(bookingHrefs))[0] || 'https://x.invalid/');
  check('a new ad click replaces the old campaign', second.searchParams.get('utm_campaign') === 'agency-oct', second.searchParams.get('utm_campaign'));
  check('a new ad click replaces the old source', second.searchParams.get('utm_source') === 'li', second.searchParams.get('utm_source'));
  check('a replaced store drops the old creative', second.searchParams.get('utm_content') === null, second.searchParams.get('utm_content'));
  check('primal_entry follows the new door', second.searchParams.get('primal_entry') === 'agencies-page', second.searchParams.get('primal_entry'));

  /* THE PATH THAT TAKES THE MONEY ON /recovery AND THE HOMEPAGE. Those two
     pages carry no booking link at all — they book through the inline embed —
     so the widget config is where their campaign has to arrive. Land on a
     link-based page, hop onto the embed page, and read what the widget was
     handed. */
  await page.goto(base + '/agencies.html?utm_source=fb&utm_campaign=embed-hop&utm_content=creative9', { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/recovery.html', { waitUntil: 'domcontentloaded' });

  /* LAZY, AND PROVEN LAZY. The widget used to load on every page open. It now
     waits for a booking CTA click or for the block to come near, because ten
     pages carry an embed and most of their readers never scroll that far.
     Assert the idle state FIRST: without it, a regression that restores the
     eager load passes every check below and the saving disappears silently. */
  await page.waitForTimeout(400);
  const idle = await page.evaluate(() => window.__calCfg || null);
  check('the calendar does not load on page open', idle === null, String(idle));

  /* Trigger one, and the one that matters most: the reader asks for it.
     ISOLATED, with an inert IntersectionObserver, because clicking a CTA also
     scrolls to the block and the scroll trigger would then load the widget on
     the click handler's behalf — so this check passed with the click trigger
     deleted, which is a guard proving nothing. A stub that is a function (so
     the code still takes the observer branch) and never fires leaves the click
     as the only path that can load it. */
  await page.addInitScript(() => {
    window.IntersectionObserver = function () {
      return { observe() {}, unobserve() {}, disconnect() {}, takeRecords() { return []; } };
    };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.click('a[data-booking]');
  await page.waitForFunction(() => window.__calCfg, null, { timeout: 5000 }).catch(() => {});
  const cal = await page.evaluate(() => (window.__calCfg && window.__calCfg.utm) || null);
  check('a booking CTA loads the calendar', cal !== null, String(cal));
  check('calendar utm_campaign survives the hop', cal && cal.utmCampaign === 'embed-hop', cal && cal.utmCampaign);
  check('calendar utm_source survives the hop', cal && cal.utmSource === 'fb', cal && cal.utmSource);
  check('calendar utm_content survives the hop', cal && cal.utmContent === 'creative9', cal && cal.utmContent);

  /* Trigger two: nobody clicks anything, they just read down the page. Caught
     800px out so the widget is there before the block is. A fresh context,
     because the one above has already loaded it. */
  {
    const ctx2 = await newPage('America/New_York');
    const p2 = await ctx2.newPage();
    await p2.goto(base + '/recovery.html', { waitUntil: 'domcontentloaded' });
    await p2.waitForTimeout(400);
    const idle2 = await p2.evaluate(() => window.__calCfg || null);
    check('still idle for a reader who has not scrolled', idle2 === null, String(idle2));
    /* Scroll the way a reader does, a screen at a time, rather than jumping.
       A single scrollIntoView() is not the same event: measured here, the jump
       lands at 5500 and the page then GROWS ~1440px as the content below it
       loads, leaving the block 1537px away — outside the 800px band, so the
       observer correctly never fires and the test reads as a broken feature.
       That is the same late layout shift scrollToCalendar()'s settle() retries
       exist to absorb, and a reader passing through the band on the way down
       trips it long before any of that matters. */
    for (let i = 0; i < 40; i++) {
      const done = await p2.evaluate(() => !!window.__calCfg);
      if (done) break;
      const atBottom = await p2.evaluate(() => {
        /* instant, not the site's default: html{scroll-behavior:smooth} only
           governs programmatic and anchor scrolling, so a real wheel or touch
           scroll is instant and an animated step here would still be moving
           when the next one fired. */
        window.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: 'instant' });
        return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      });
      await p2.waitForTimeout(60);
      if (atBottom) break;
    }
    await p2.waitForFunction(() => window.__calCfg, null, { timeout: 5000 }).catch(() => {});
    const scrolled = await p2.evaluate(() => window.__calCfg || null);
    check('scrolling to the block loads the calendar', scrolled !== null, String(scrolled));
    await ctx2.close();
  }

  /* THE SHARED BLOCK, on a page that only just got one. Everything above
     exercises /recovery, which carries its own page-scoped .rc-cal-* copy and
     proved the shape first. Seven vertical pages moved onto the SHARED
     .cal-wrap / .cal-embed on 2026-09-10, and nothing was covering it — a
     class rename or a missing stylesheet on those pages would have shown up
     as a white card in production and green here. */
  {
    const ctx3 = await newPage('America/New_York');
    const p3 = await ctx3.newPage();
    await p3.goto(base + '/agencies.html?utm_source=fb&utm_campaign=shared-block&utm_content=creative3',
      { waitUntil: 'domcontentloaded' });
    const wrap = await p3.evaluate(() => {
      const el = document.querySelector('.cal-wrap .cal-embed[data-calendly-url]');
      if (!el) return null;
      return { url: el.getAttribute('data-calendly-url'), h: Math.round(el.getBoundingClientRect().height) };
    });
    check('the shared block is on the page', wrap !== null, String(wrap));
    check('it books a real https event', !!wrap && wrap.url.startsWith('https://'), wrap && wrap.url);
    /* The reserved height is what stops a lazily-loaded widget shoving the
       page down under somebody mid-read. If the stylesheet ever stops
       reaching these pages this collapses to 0 and says so. */
    check('its height is reserved before the widget arrives', !!wrap && wrap.h > 400, wrap && wrap.h);
    await p3.click('a[data-booking]');
    await p3.waitForFunction(() => window.__calCfg, null, { timeout: 5000 }).catch(() => {});
    const c3 = await p3.evaluate(() => (window.__calCfg && window.__calCfg.utm) || null);
    check('a CTA on a vertical page loads the shared calendar', c3 !== null, String(c3));
    check('the shared calendar carries the campaign', c3 && c3.utmCampaign === 'shared-block', c3 && c3.utmCampaign);
    await ctx3.close();
  }

  /* The challenge decorator makes the same promise in its own comment — "the
     campaign name and any ref survive the hop" — so it is held to it here.
     utm_source is excluded on purpose: that decorator overwrites it with the
     door, which is a deliberate trade documented where it happens. */
  await page.goto(base + '/agencies.html?utm_campaign=chal-hop&ref=partner7', { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/coaching.html', { waitUntil: 'domcontentloaded' });
  const chal = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="https://app.primalsales.ai/brittany"]')].map((a) => a.href));
  check('coaching page has a challenge link', chal.length > 0, `found ${chal.length}`);
  const cu = new URL(chal[0] || 'https://x.invalid/');
  check('challenge link keeps the campaign across the hop', cu.searchParams.get('utm_campaign') === 'chal-hop', cu.searchParams.get('utm_campaign'));
  check('challenge link keeps ref across the hop', cu.searchParams.get('ref') === 'partner7', cu.searchParams.get('ref'));
  check('challenge link still stamps the door in utm_source', cu.searchParams.get('utm_source') === 'coaching-page', cu.searchParams.get('utm_source'));

  await ctx.close();
}

/* ── 2. the live url always outranks the store ───────────────────── */
/* The two can only disagree when a write fails — private mode, a full quota —
   and then the store is a stale campaign while the reader is looking at a live
   one. Whatever the ad just said has to win, or a browser that refuses storage
   quietly files every later click under the first campaign it ever saw. */
{
  const ctx = await newPage('America/New_York');
  const page = await ctx.newPage();
  await page.goto(base + '/agencies.html?utm_source=fb&utm_campaign=first-ad', { waitUntil: 'domcontentloaded' });
  await page.addInitScript(() => { sessionStorage.setItem = function () {}; });
  await page.goto(base + '/hubspot-audit.html?utm_source=li&utm_campaign=second-ad', { waitUntil: 'domcontentloaded' });
  const live = new URL((await page.evaluate(bookingHrefs))[0] || 'https://x.invalid/');
  check('the live url outranks a stale store (campaign)', live.searchParams.get('utm_campaign') === 'second-ad', live.searchParams.get('utm_campaign'));
  check('the live url outranks a stale store (source)', live.searchParams.get('utm_source') === 'li', live.searchParams.get('utm_source'));
  await ctx.close();
}

/* ── 3. consent withdrawn after a store already exists ──────────────── */
/* Declining does not empty a store that was written while they were opted in,
   so the READ has to answer to consent too. Otherwise "turning them off"
   leaves marketing attribution still travelling onto the booking link, which
   is the promise the privacy page makes in those words. */
{
  const ctx = await newPage('America/New_York');
  const page = await ctx.newPage();
  await page.goto(base + '/recovery.html' + AD, { waitUntil: 'domcontentloaded' });
  const wrote = await page.evaluate(() => sessionStorage.getItem('primal_attribution'));
  check('a store exists before consent is withdrawn', wrote !== null, String(wrote));

  await page.evaluate(() => localStorage.setItem('primal_consent',
    JSON.stringify({ v: 1, state: 'denied', ts: new Date().toISOString() })));
  await page.goto(base + '/hubspot-audit.html', { waitUntil: 'domcontentloaded' });

  const stillThere = await page.evaluate(() => sessionStorage.getItem('primal_attribution'));
  check('the store survives the denial (nothing is quietly deleted)', stillThere !== null, String(stillThere));
  const denied = new URL((await page.evaluate(bookingHrefs))[0] || 'https://x.invalid/');
  check('a withdrawn consent stops the store being READ', denied.searchParams.get('utm_campaign') === null, denied.searchParams.get('utm_campaign'));
  await ctx.close();
}

/* ── 3b. one booking, one conversion ─────────────────────────────────── */
/* The server sends the Schedule for a Calendly booking, and only one side
   can: the workflow forwards a GoHighLevel contact record carrying none of
   Calendly's own ids, so there is no value both halves hold and therefore no
   shared event_id. Two reports of one booking would double the only figure
   the ad spend is read off. */
{
  const ctx = await newPage('America/New_York');
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__fbq = [];
    window.fbq = function () { window.__fbq.push([...arguments]); };
  });
  await page.goto(base + '/recovery.html', { waitUntil: 'domcontentloaded' });

  await page.evaluate(() => {
    window.postMessage({
      event: 'calendly.event_scheduled',
      payload: {
        event: { uri: 'https://api.calendly.com/scheduled_events/slot' },
        invitee: { uri: 'https://api.calendly.com/scheduled_events/slot/invitees/0e436d68' },
      },
    }, '*');
  });
  /* Nothing to wait FOR, so wait for the page to have finished handling it:
     booking_completed is emitted on the same turn and is the observable that
     proves the branch ran at all. Asserting "no Schedule" without that would
     pass on a page that never received the message. */
  await page.waitForFunction(() => (window.__fbq || []).length > 0 || window.__seen, null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(250);

  const calls = await page.evaluate(() => window.__fbq || []);
  const sched = calls.filter((c) => c[1] === 'Schedule');
  check('the page sends NO Schedule — the server owns that conversion', sched.length === 0,
    `fired ${sched.length}: ${JSON.stringify(sched[0] || null)}`);

  /* The funnel report must not lose the booking with it. */
  const custom = calls.filter((c) => c[0] === 'trackCustom' && c[1] === 'booking_completed');
  check('the booking is still reported to the funnel', custom.length === 1, `fired ${custom.length}`);

  await ctx.close();
}

/* ── 4. strict region, nothing accepted: no storage, no cross-page carry ── */
{
  const ctx = await newPage('Europe/London');
  const page = await ctx.newPage();
  await page.goto(base + '/recovery.html' + AD, { waitUntil: 'domcontentloaded' });

  const stored = await page.evaluate(() => sessionStorage.getItem('primal_attribution'));
  check('strict region stores nothing before consent', stored === null, String(stored));

  const flag = await page.evaluate(() => window.primalMarketingAllowed);
  check('strict region reports marketing storage not allowed', flag === false, String(flag));

  await page.goto(base + '/hubspot-audit.html', { waitUntil: 'domcontentloaded' });
  const afterHop = new URL((await page.evaluate(bookingHrefs))[0] || 'https://x.invalid/');
  check('strict region drops attribution on the hop, as consent requires',
    afterHop.searchParams.get('utm_campaign') === null, afterHop.searchParams.get('utm_campaign'));

  await ctx.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} attribution check(s) failed`);
  process.exit(1);
}
console.log('\nattribution chain intact');
