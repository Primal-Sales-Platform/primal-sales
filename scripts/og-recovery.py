"""
/recovery's own social card. Sibling of scripts/og-playbook — same palette,
same geometry, different offer, so the two pages read as one system when
somebody shares both into the same channel.

Generated rather than designed in a tool so it can be regenerated when the
copy changes, and so it can never drift from the page's own palette — the
five colours below are read from primal.css :root, not eyeballed.

No number on it, deliberately. /recovery's own hero card carries an
illustrative 76% with a label saying so; a social card has no room for that
label, and a figure with nowhere to say "example" reads as a measured result
from somebody's CRM. The three findings carry the offer instead.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
NAVY        = (26, 54, 93)
DEEP_ORANGE = (192, 86, 33)
GOLD        = (214, 158, 46)
CREAM       = (253, 248, 240)
DEEPER      = (10, 16, 28)

S  = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

img = Image.new("RGB", (W, H), DEEPER)
d = ImageDraw.Draw(img)

# warm wash, top-left, matching the page's own hero mesh
for y in range(H):
    for band in (0,):
        pass
grad = Image.new("RGB", (W, H), DEEPER)
gd = ImageDraw.Draw(grad)
for i in range(260):
    a = 1 - (i / 260)
    gd.ellipse([-300 + i, -320 + i, 620 - i, 560 - i],
               fill=(int(10 + 34 * a), int(16 + 14 * a), int(28 + 6 * a)))
img = Image.blend(img, grad, 0.55)
d = ImageDraw.Draw(img)

# top rule, the page's own orange
d.rectangle([0, 0, W, 8], fill=DEEP_ORANGE)

# eyebrow
f_eye = ImageFont.truetype(MO, 20)
d.text((72, 64), "FREE PIPELINE RECOVERY AUDIT", font=f_eye, fill=GOLD)

# headline — the page's own H1, wrapped by hand so the break lands where
# the page breaks it rather than wherever a width happens to fall
f_h = ImageFont.truetype(S, 60)
lines = ["Stop buying leads", "you already own."]
y = 148
for ln in lines:
    d.text((72, y), ln, font=f_h, fill=CREAM)
    y += 76

# the three artifacts
f_lab = ImageFont.truetype(MO, 19)
f_num = ImageFont.truetype(SB, 19)
y = 372
for n, label in (("01", "Dormant revenue"), ("02", "Where follow-up broke"), ("03", "What to work first")):
    d.text((72, y), n, font=f_lab, fill=DEEP_ORANGE)
    d.text((116, y - 1), label, font=f_num, fill=CREAM)
    y += 36

# the ask, bottom rail
f_ask = ImageFont.truetype(SS, 22)
d.rectangle([72, 540, 76, 578], fill=GOLD)
d.text((96, 542), "Read-only audit of the CRM you already run.", font=f_ask, fill=(226, 216, 202))
d.text((96, 570), "HubSpot or GoHighLevel. No migration.", font=f_ask, fill=(150, 160, 172))

# wordmark
f_w = ImageFont.truetype(SB, 22)
mark = "PrimalSales.ai"
mw = d.textlength(mark, font=f_w)
d.text((W - 72 - mw, 64), mark, font=f_w, fill=CREAM)

img.save("og-recovery.png", optimize=True)
print("wrote og-recovery.png")
