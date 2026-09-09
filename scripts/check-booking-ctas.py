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

BOOKING_HOST = "go.primalsales.ai"
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
        if BOOKING_HOST not in tag and INLINE_ATTR not in tag:
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

for filename, tag in violations:
    print(f"{filename}: booking CTA opens a new tab\n    {tag}")

print(f"\nchecked {checked} booking CTAs across the site — {len(violations)} opening a new tab")
sys.exit(1 if violations else 0)
