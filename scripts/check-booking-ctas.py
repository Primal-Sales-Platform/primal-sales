"""
Every booking CTA must open in the SAME tab.

Why this exists, because the opposite reads as the obvious default and will
be re-added by anyone copying an older button: most of this site's paid
traffic arrives inside Facebook's and Instagram's in-app browsers, which are
single-view WebViews with no tabs. target="_blank" there is unreliable —
sometimes a new in-app view, sometimes silently nothing — and primal.js fires
cta_click and the Meta `Contact` event on the CLICK, before the browser has
done anything with the destination. So a swallowed new tab is invisible: the
ad account records a person heading for the calendar who never arrived, and
the campaign optimises toward more of them.

Measured 2026-09-09, 30 days: 169 booking-CTA clicks from phones, one
booking; 1 from desktop, five bookings. Same-tab navigation is the only
form of that link a WebView cannot drop.

Non-booking links (LinkedIn, the app, images) keep target="_blank" — the
argument above is about the destination that takes the money, not about
new tabs in general.

Run: python3 scripts/check-booking-ctas.py   (exits 1 on a violation)
"""
import glob
import os
import re
import sys

# These are the three hosts primal.js itself treats as a booking link
# (isBookingHref). The check knew only the first, so a Calendly or
# LeadConnector booking link could carry target="_blank" straight past the
# same-tab rule below — which is the exact failure this file exists to stop.
# Keep this list and isBookingHref in step.
BOOKING_HOSTS = ("go.primalsales.ai", "calendly.com", "leadconnectorhq.com/widget/booking")


def is_booking(text):
    return any(h in text for h in BOOKING_HOSTS)

# A booking CTA is either one that navigates to the booking host, or one
# marked data-booking because it scrolls to a calendar embedded on the page.
# Both spellings have to be covered or the check goes half-blind the moment a
# page moves to an inline calendar: /recovery did exactly that and the count
# silently dropped from 48 to 40 while still reporting a clean pass.
INLINE_ATTR = "data-booking"
ANCHOR = re.compile(r"<a\s[^>]*>", re.I)

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
violations = []
checked = 0

for path in sorted(glob.glob(os.path.join(root, "*.html"))):
    with open(path, encoding="utf-8") as fh:
        html = fh.read()
    for tag in ANCHOR.findall(html):
        if not is_booking(tag) and INLINE_ATTR not in tag:
            continue
        checked += 1
        if re.search(r'target\s*=\s*["\']?_blank', tag, re.I):
            violations.append((os.path.basename(path), tag[:110]))

if checked == 0:
    print("FAIL: no booking CTAs found at all — this check is scanning nothing.")
    sys.exit(1)

# An inline CTA must not be left to the browser's own anchor jump. This page
# loads a video and several images above the calendar, and they finish after
# the jump: measured 2026-09-09, the section moved 1463px further down on a
# 1440x900 desktop and the browser never re-scrolled, so the reader landed in
# open page looking at nothing. primal.js takes the click and scrolls itself.
#
# This is a SOURCE pin, not a behavioural one. The repo has no CI and no test
# runner, so a browser test here would be a script nobody runs. It catches the
# handler being deleted, which is the regression that actually happens.
if any(INLINE_ATTR in tag for path in sorted(glob.glob(os.path.join(root, "*.html")))
       for tag in ANCHOR.findall(open(path, encoding="utf-8").read())):
    js = open(os.path.join(root, "primal.js"), encoding="utf-8").read()
    js = re.sub(r"/\*.*?\*/", " ", js, flags=re.S)
    # Pin the CALL SITE, not the function's existence. A first cut looked for
    # the bare token "scrollToCalendar()", which the function's own declaration
    # satisfies — deleting the handler's body left this check green.
    at = js.find("a[data-booking]")
    handler = js[at:at + 600] if at != -1 else ""
    if at == -1 or "scrollToCalendar(" not in handler or "preventDefault" not in handler:
        print("FAIL: inline booking CTAs exist but primal.js does not intercept the click.")
        print("      Without that the browser's anchor jump lands short of the calendar.")
        sys.exit(1)

# ---------------------------------------------------------------------------
# A booking CTA must promise the BOOKING, not an instant number.
#
# Why this exists: /recovery spent its first month asking people to "Get my
# number" on a button that opens a calendar. The ad promises the problem
# insight, the page promises the audit, and the button promises the booking —
# a button that promises a readout and delivers a scheduling widget changes the
# offer at the moment somebody decides. Measured 2026-09-09, 30 days: 170
# booking-CTA clicks, six bookings.
#
# The listed phrases are the ones that were actually on the page. This reads the
# CTA's own label only, so body copy that talks about a number is untouched —
# the claim being checked is what the BUTTON says it does.
INSTANT_PROMISE = (
    "get my number",
    "show me my number",
    # 2026-09-10: /agencies carried "Show me the number" on all three of its
    # booking CTAs and walked straight past this list, which had only the "my"
    # spelling. One word is not a different promise — the button still said a
    # figure and still opened a scheduling widget. Both spellings now.
    "show me the number",
    "show me my leakage",
    "find my number",
    "get my score",
    "my number now",
    "instant audit",
    "instant number",
)
# What a booking button has to say it does. Kept deliberately small: these are
# the verbs actually in use, and a new one should be a decision somebody makes
# on purpose rather than a word that quietly slips past.
BOOKING_VERBS = ("book", "grab", "schedule", "reserve", "pick a time", "choose a time")
ANCHOR_FULL = re.compile(r"<a\s([^>]*)>(.*?)</a>", re.I | re.S)
# The half a phone does not render.
TAIL = re.compile(r'<span[^>]*class="[^"]*cta-tail[^"]*"[^>]*>.*?</span>', re.I | re.S)
TAGS = re.compile(r"<[^>]+>")
scanned_text = 0
promise_violations = []

for path in sorted(glob.glob(os.path.join(root, "*.html"))):
    with open(path, encoding="utf-8") as fh:
        html = fh.read()
    for attrs, inner in ANCHOR_FULL.findall(html):
        if not is_booking(attrs) and INLINE_ATTR not in attrs:
            continue
        scanned_text += 1
        label = " ".join(TAGS.sub(" ", inner).split()).lower()
        # A label can be TRUNCATED on phones: /agencies wraps the tail of
        # "Book the call, keep the number" in <span class="cta-tail">, which
        # primal.css hides under 640px so the button does not crowd the logo.
        # The rendered mobile label is therefore a DIFFERENT string, and it is
        # the one most of the paid traffic reads. Check it too — hiding the
        # wrong half would leave a phone button reading "keep the number" over
        # a scheduling widget, which is this whole check's reason for existing,
        # and reading textContent alone would never see it.
        truncated = " ".join(TAGS.sub(" ", TAIL.sub(" ", inner)).split()).lower()
        for candidate in {label, truncated}:
            hit = next((p for p in INSTANT_PROMISE if p in candidate), None)
            if hit:
                promise_violations.append((os.path.basename(path), candidate[:70], hit))
                break
        # A truncation that leaves nothing to promise is its own failure.
        if truncated != label and not truncated.strip():
            promise_violations.append((os.path.basename(path), '(empty on mobile)', 'nothing left'))
        # THE RULE STATED POSITIVELY, because the banned list above can only
        # ever catch the phrasings somebody already shipped. "Book the call,
        # keep the number" is fine and "keep the number" is not, and no
        # substring ban can express that difference — the second is a subset of
        # the first. What actually separates them is whether the button still
        # says it books something. Every one of the site's 16 distinct booking
        # labels opens with Book or Grab, so this costs nothing today and is
        # the check that catches a truncation hiding the wrong half.
        for candidate in {label, truncated}:
            if candidate.strip() and not any(v in candidate for v in BOOKING_VERBS):
                promise_violations.append(
                    (os.path.basename(path), candidate[:70], 'promises no booking'))
                break

# Same posture as the count check above: a scanner that reads nothing passes for
# the wrong reason.
if scanned_text == 0:
    print("FAIL: no booking CTA text was read — this check is scanning nothing.")
    sys.exit(1)

# ---------------------------------------------------------------------------
# An embedded calendar must carry a real URL.
#
# primal.js only initialises the widget when data-calendly-url has a value, so
# a placeholder or an emptied attribute produces a white card the size of a
# calendar with nothing in it — and the page's CTAs still scroll people to it,
# because scrollToCalendar only needs the node to exist. That failure looks
# exactly like a slow load. This repo has no CI, so the check has to be the
# thing that says it out loud.
CAL_URL = re.compile(r'data-calendly-url\s*=\s*"([^"]*)"', re.I)
cal_urls = 0
cal_violations = []

for path in sorted(glob.glob(os.path.join(root, "*.html"))):
    with open(path, encoding="utf-8") as fh:
        html = fh.read()
    for url in CAL_URL.findall(html):
        cal_urls += 1
        if not url.startswith("https://"):
            cal_violations.append((os.path.basename(path), url or "(empty)"))

for filename, url in cal_violations:
    print(f"{filename}: embedded calendar has no real URL\n    {url}")

for filename, tag in violations:
    print(f"{filename}: booking CTA opens a new tab\n    {tag}")

for filename, label, phrase in promise_violations:
    print(f'{filename}: booking CTA promises an instant number, not a booking\n'
          f'    "{label}"  [{phrase}]')

print(f"\nchecked {checked} booking CTAs across the site — {len(violations)} opening a new tab")
print(f"read {scanned_text} booking CTA labels — {len(promise_violations)} promising an instant number")
print(f"read {cal_urls} embedded calendar URLs — {len(cal_violations)} unresolved")
sys.exit(1 if (violations or promise_violations or cal_violations) else 0)
