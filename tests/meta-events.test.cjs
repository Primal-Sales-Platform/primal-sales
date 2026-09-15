/**
 * tests/meta-events.test.cjs — what the Meta pixel hears from this site.
 *
 * The pixel is the one tracker that decides where money goes. Three things
 * are pinned here, each by RUNNING the real code slice against a fake fbq:
 *
 *  - Every custom event emit() sends is HOUSE-GATED. Before 2026-09-15 the
 *    founder's own walk-throughs reached the ad account as cta_click and
 *    booking_time_selected, and the moment a Custom Conversion is built on
 *    one of those, an ungated event teaches the optimiser that a buyer looks
 *    like him. GA, the dataLayer and Plausible still hear a house visit.
 *  - The click INTO the free call review fires PlaybookCtaClick once per page
 *    load, house-gated, and only for links into app.primalsales.ai's preview.
 *  - The SAME click is beaconed first-party as playbook_cta_click, which is
 *    NOT house-gated (the row carries house:1 instead). That row is what the
 *    app's Meta Conversions Check counts, so the two must fire on the same
 *    clicks or the card answers "is the event arriving" off a different
 *    population than the one Meta receives.
 *  - The hop decorator and the click handler share ONE definition of which
 *    links those are.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../primal.js'), 'utf8');

function slice(from, to) {
  const a = source.indexOf(from); assert.ok(a >= 0, `slice start not found: ${from}`);
  const b = source.indexOf(to, a + 1); assert.ok(b > a, `slice end not found: ${to}`);
  return source.slice(a, b);
}

// ─── emit(): house visits never reach the pixel ─────────────────────────────

const emitSrc = slice('  function emit(', '\n  /* ONE definition of "this link opens a booking calendar"');
function runEmit({ house }) {
  const fbq = [], gtag = [], dataLayer = [], plausible = [], beacons = [];
  const window = {
    fbq: (...a) => fbq.push(a), gtag: (...a) => gtag.push(a), dataLayer, plausible: (...a) => plausible.push(a),
  };
  const run = new Function('window', 'page', 'funnelBeacon', 'contentsquareBookingEvent', 'conversionsAllowed', 'console', emitSrc + '; return emit;');
  const emit = run(window, 'recovery', (n) => beacons.push(n), () => {}, () => !house, { debug() {} });
  return { emit, fbq, gtag, dataLayer, plausible };
}

test('a real visitor\'s event reaches every tracker, the pixel included, as a custom event of the same name', () => {
  const r = runEmit({ house: false });
  r.emit('booking_time_selected', {});
  assert.deepEqual(r.fbq, [['trackCustom', 'booking_time_selected', { page: 'recovery' }]]);
  assert.equal(r.gtag.length, 1); assert.equal(r.dataLayer.length, 1); assert.equal(r.plausible.length, 1);
});

test('a HOUSE visit still reaches GA, the dataLayer and Plausible — and never the pixel', () => {
  const r = runEmit({ house: true });
  r.emit('booking_time_selected', {});
  r.emit('cta_click', { cta: 'hero-playbook-build' });
  assert.deepEqual(r.fbq, [], 'the ad account must not hear our own walk-throughs');
  assert.equal(r.gtag.length, 2, 'measuring never stops; only the ad account does');
  assert.equal(r.dataLayer.length, 2);
});

test('page_view never reaches the pixel either way (the head snippet already fired PageView)', () => {
  const r = runEmit({ house: false });
  r.emit('page_view', {});
  assert.deepEqual(r.fbq, []);
});

// ─── the click handler ──────────────────────────────────────────────────────

const hrefDefs = slice('  function isBookingHref(', '\n  /* HOUSE SUPPRESSION.');
const handlerSrc = slice('  var ctaClicked = false;', '\n  var marks = [25, 50, 75, 100]');
assert.match(hrefDefs, /function isPlaybookHref\(/, 'the shared definition must sit beside isBookingHref');

function runHandler({ house = false } = {}) {
  const fbq = [], emitted = [], beacons = [];
  let listener = null;
  const document = { addEventListener: (type, fn, capture) => { assert.equal(type, 'click'); assert.equal(capture, true); listener = fn; } };
  const window = { fbq: (...a) => fbq.push(a) };
  const run = new Function('document', 'window', 'page', 'emit', 'funnelBeacon', 'contentsquareBookingEvent', 'conversionsAllowed',
    hrefDefs + handlerSrc);
  run(document, window, 'playbook', (n, p) => emitted.push([n, p]), (n) => beacons.push(n), () => {}, () => !house);
  assert.ok(listener, 'the handler must register on document');
  const click = (href, attrs = {}) => {
    const a = { href, textContent: 'Review my calls free', getAttribute: (k) => (k === 'href' ? href : (attrs[k] ?? null)) };
    listener({ target: { closest: () => a } });
  };
  return { click, fbq, emitted, beacons };
}

const PREVIEW = 'https://app.primalsales.ai/playbook-preview';
const BOOKING = 'https://go.primalsales.ai/booking';

test('a click into the free call review fires PlaybookCtaClick — a CUSTOM event, once per page load, beside the ordinary cta_click', () => {
  const r = runHandler();
  r.click(PREVIEW + '?utm_content=t2_a&pj=abc', { 'data-cta': 'hero-playbook-build' });
  r.click(PREVIEW, { 'data-cta': 'final-playbook-build' });
  assert.deepEqual(r.fbq, [['trackCustom', 'PlaybookCtaClick', { cta: 'hero-playbook-build', page: 'playbook' }]],
    'eight identical buttons are one person heading to the same form once');
  assert.equal(r.emitted.filter(([n]) => n === 'cta_click').length, 2, 'the analytics click still counts every press');
  assert.deepEqual(r.beacons, ['cta_click', 'playbook_cta_click', 'cta_click'],
    'the first-party record of the review click fires once, in the same branch as the pixel event');
});

test('the first-party playbook_cta_click is NOT house-gated — the row is marked, never dropped', () => {
  const r = runHandler({ house: true });
  r.click(PREVIEW, { 'data-cta': 'hero-playbook-build' });
  assert.deepEqual(r.fbq, [], 'the ad account hears nothing');
  assert.ok(r.beacons.includes('playbook_cta_click'),
    'the founder verifies his own funnel by walking it; the beacon carries house:1 and the dashboard skips it');
});

test('playbook_cta_click is beaconed on exactly the clicks the pixel event fires on', () => {
  const r = runHandler();
  r.click(BOOKING, { 'data-cta': 'hero-book' });
  r.click('https://example.com/playbook-preview', { 'data-cta': 'x' });
  assert.ok(!r.beacons.includes('playbook_cta_click'), 'a booking link and another host are not a review click');
  r.click(PREVIEW, { 'data-cta': 'hero-playbook-build' });
  assert.equal(r.beacons.filter((b) => b === 'playbook_cta_click').length, 1);
  assert.equal(r.fbq.filter((a) => a[1] === 'PlaybookCtaClick').length, 1, 'one beacon, one pixel event');
});

test('a HOUSE click into the review fires nothing at the pixel', () => {
  const r = runHandler({ house: true });
  r.click(PREVIEW, { 'data-cta': 'hero-playbook-build' });
  assert.deepEqual(r.fbq, []);
  assert.equal(r.emitted.length, 1, 'measured, not reported to the ad account');
});

test('a booking link fires Contact and never PlaybookCtaClick; a preview link never fires Contact', () => {
  const r = runHandler();
  r.click(BOOKING, { 'data-cta': 'hero-book' });
  r.click(PREVIEW, { 'data-cta': 'hero-playbook-build' });
  assert.deepEqual(r.fbq.map((a) => [a[0], a[1]]), [['track', 'Contact'], ['trackCustom', 'PlaybookCtaClick']]);
});

test('a preview link with no data-cta is still counted, under its own label, instead of being dropped', () => {
  const r = runHandler();
  r.click(PREVIEW);
  assert.deepEqual(r.fbq, [['trackCustom', 'PlaybookCtaClick', { cta: 'playbook-preview', page: 'playbook' }]]);
});

test('only the preview page counts: another app path, another host, http', () => {
  const r = runHandler();
  for (const href of ['https://app.primalsales.ai/brittany', 'https://app.primalsales.ai/playbook-previewer', 'https://example.com/playbook-preview', 'http://app.primalsales.ai/playbook-preview']) {
    r.click(href, { 'data-cta': 'x' });
  }
  assert.deepEqual(r.fbq, []);
});

// ─── one definition, two readers ────────────────────────────────────────────

test('the hop decorator and the click handler read the SAME isPlaybookHref', () => {
  const hop = slice('  var PLAYBOOK_HOP_KEYS =', '\n  function funnelBeacon');
  assert.match(hop, /if \(isPlaybookHref\(u\.href\)\)/, 'the hop must not carry its own host+path test');
  assert.match(handlerSrc, /var isPlaybookCta = isPlaybookHref\(a\.href \|\| href\)/);
  assert.equal(source.split('function isPlaybookHref(').length - 1, 1, 'exactly one definition');
});
