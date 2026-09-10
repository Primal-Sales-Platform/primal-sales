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
  await page.goto(base + '/pricing.html', { waitUntil: 'domcontentloaded' });
  const hopped = await page.evaluate(bookingHrefs);
  check('page after the hop has booking links', hopped.length > 0, `found ${hopped.length}`);

  const u = new URL(hopped[0] || 'https://x.invalid/');
  check('utm_source survives the hop', u.searchParams.get('utm_source') === 'fb', u.searchParams.get('utm_source'));
  check('utm_campaign survives the hop', u.searchParams.get('utm_campaign') === 'recovery-sept', u.searchParams.get('utm_campaign'));
  check('utm_content survives the hop', u.searchParams.get('utm_content') === 'ghosted-creative', u.searchParams.get('utm_content'));
  check('fbclid survives the hop', u.searchParams.get('fbclid') === 'ABC123', u.searchParams.get('fbclid'));
  check('primal_entry names the landing page', u.searchParams.get('primal_entry') === 'recovery-page', u.searchParams.get('primal_entry'));
  check('primal_page still names the CURRENT page', u.searchParams.get('primal_page') === 'pricing-page', u.searchParams.get('primal_page'));

  /* A second ad click REPLACES rather than merges: campaign B's booking must
     never carry campaign A's source. */
  await page.goto(base + '/agencies.html?utm_source=li&utm_campaign=agency-oct', { waitUntil: 'domcontentloaded' });
  await page.goto(base + '/pricing.html', { waitUntil: 'domcontentloaded' });
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
  await page.waitForFunction(() => window.__calCfg, null, { timeout: 5000 }).catch(() => {});
  const cal = await page.evaluate(() => (window.__calCfg && window.__calCfg.utm) || null);
  check('the inline calendar was initialised at all', cal !== null, String(cal));
  check('calendar utm_campaign survives the hop', cal && cal.utmCampaign === 'embed-hop', cal && cal.utmCampaign);
  check('calendar utm_source survives the hop', cal && cal.utmSource === 'fb', cal && cal.utmSource);
  check('calendar utm_content survives the hop', cal && cal.utmContent === 'creative9', cal && cal.utmContent);

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
  await page.goto(base + '/pricing.html?utm_source=li&utm_campaign=second-ad', { waitUntil: 'domcontentloaded' });
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
  await page.goto(base + '/pricing.html', { waitUntil: 'domcontentloaded' });

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

  await page.goto(base + '/pricing.html', { waitUntil: 'domcontentloaded' });
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
