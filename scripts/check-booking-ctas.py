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

for filename, tag in violations:
    print(f"{filename}: booking CTA opens a new tab\n    {tag}")

print(f"\nchecked {checked} booking CTAs across the site — {len(violations)} opening a new tab")
sys.exit(1 if violations else 0)
