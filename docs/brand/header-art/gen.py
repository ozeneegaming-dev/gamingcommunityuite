# Imaginile antetului incluse în GCS (`header.art`), desenate de la zero pentru brand („Forja”: bleumarin #0B0F17,
# accent #DF390C, chihlimbar #F2B33D). Scriptul scrie SVG-urile (`python gen.py`); JPG-urile din
# `apps/web/app/_art/header-<nume>.jpg` sunt SVG-urile randate în Chromium la 3840 × 520 (dublu, pentru ecranele
# clare), apoi salvate progresiv cu calitatea 84.
# Două variante: „forja” (jarul și strălucirea din spatele logo-ului) și „arena” (fațete unghiulare și fascicule).
import math
import random

W, H = 1920, 260
CX = W / 2


def embers(rnd, n, spread):
    out = []
    for _ in range(n):
        # Mai dese spre centru (de sub logo), dar prezente pe toată lățimea.
        x = CX + rnd.gauss(0, spread) if rnd.random() < 0.7 else rnd.uniform(0, W)
        if not 0 <= x <= W:
            continue
        y = rnd.uniform(10, H - 20)
        r = rnd.choice([0.6, 0.8, 1, 1.2, 1.4, 1.8, 2.2, 2.8])
        color = rnd.choice(["#F2B33D", "#FF8A3D", "#DF390C", "#FFC870", "#FF6A3D"])
        op = rnd.uniform(0.35, 1)
        blur = ' filter="url(#soft)"' if r > 1.6 or rnd.random() < 0.25 else ""
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{color}" opacity="{op:.2f}"{blur}/>')
    # Scântei: linii scurte, înclinate în sus, cu capătul estompat.
    for _ in range(46):
        x = CX + rnd.gauss(0, spread * 0.9)
        if not 0 <= x <= W:
            continue
        y = rnd.uniform(40, H - 10)
        ln = rnd.uniform(8, 26)
        ang = math.radians(rnd.uniform(-115, -65))
        x2, y2 = x + ln * math.cos(ang), y + ln * math.sin(ang)
        out.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="url(#spark)" stroke-width="1.3" stroke-linecap="round" opacity="{rnd.uniform(0.4, 0.9):.2f}"/>')
    return "\n".join(out)


def slashes(side):
    # Benzile înclinate, ca barele crestăturii logo-ului, oglindite de o parte și de alta.
    s = 1 if side == "left" else -1
    base = 250 if side == "left" else W - 250
    out = []
    for dx, w, op in ((0, 60, 0.07), (90, 26, 0.10), (140, 8, 0.32), (176, 3, 0.55), (330, 90, 0.045)):
        x = base + s * dx
        sk = 70 * s
        pts = [(x, -10), (x + w * s, -10), (x + w * s + sk, H + 10), (x + sk, H + 10)]
        d = " ".join(f"{px:.1f},{py:.1f}" for px, py in pts)
        out.append(f'<polygon points="{d}" fill="url(#slash)" opacity="{op}"/>')
    return "\n".join(out)


def defs(extra=""):
    return f"""<defs>
  <linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#131a29"/><stop offset="0.6" stop-color="#0e1320"/><stop offset="1" stop-color="#0b0f17"/></linearGradient>
  <radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="{CX}" cy="20" r="640" gradientTransform="translate({CX} 20) scale(1 0.42) translate({-CX} -20)"><stop offset="0" stop-color="#FF6A3D" stop-opacity="0.8"/><stop offset="0.3" stop-color="#DF390C" stop-opacity="0.42"/><stop offset="0.65" stop-color="#DF390C" stop-opacity="0.12"/><stop offset="1" stop-color="#DF390C" stop-opacity="0"/></radialGradient>
  <radialGradient id="core" gradientUnits="userSpaceOnUse" cx="{CX}" cy="10" r="170" gradientTransform="translate({CX} 10) scale(1 0.55) translate({-CX} -10)"><stop offset="0" stop-color="#F2B33D" stop-opacity="0.6"/><stop offset="1" stop-color="#F2B33D" stop-opacity="0"/></radialGradient>
  <radialGradient id="emberL" gradientUnits="userSpaceOnUse" cx="300" cy="{H}" r="420" gradientTransform="translate(300 {H}) scale(1 0.5) translate(-300 {-H})"><stop offset="0" stop-color="#DF390C" stop-opacity="0.22"/><stop offset="1" stop-color="#DF390C" stop-opacity="0"/></radialGradient>
  <radialGradient id="emberR" gradientUnits="userSpaceOnUse" cx="{W - 300}" cy="{H}" r="420" gradientTransform="translate({W - 300} {H}) scale(1 0.5) translate({300 - W} {-H})"><stop offset="0" stop-color="#DF390C" stop-opacity="0.22"/><stop offset="1" stop-color="#DF390C" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig" cx="0.5" cy="0.4" r="0.75"><stop offset="0.55" stop-color="#05070c" stop-opacity="0"/><stop offset="1" stop-color="#05070c" stop-opacity="0.75"/></radialGradient>
  <linearGradient id="slash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6A3D"/><stop offset="1" stop-color="#DF390C" stop-opacity="0.2"/></linearGradient>
  <linearGradient id="spark" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFC870"/><stop offset="1" stop-color="#DF390C" stop-opacity="0"/></linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0f17" stop-opacity="0"/><stop offset="1" stop-color="#0b0f17" stop-opacity="0.9"/></linearGradient>
  <filter id="soft" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="1.4"/></filter>
  <filter id="smoke" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.016" numOctaves="4" seed="7"/>
    <feColorMatrix values="0 0 0 0 0.32  0 0 0 0 0.36  0 0 0 0 0.46  0 0 0 1.25 -0.52"/>
  </filter>
  <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)"><line x1="0" y1="0" x2="0" y2="7" stroke="#8fa3c7" stroke-width="1" opacity="0.06"/></pattern>
  {extra}
</defs>"""


def forja():
    rnd = random.Random(2026)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
{defs()}
<rect width="{W}" height="{H}" fill="url(#base)"/>
<rect width="{W}" height="{H}" fill="url(#hatch)"/>
<rect width="{W}" height="{H}" filter="url(#smoke)" opacity="0.4"/>
<rect width="{W}" height="{H}" fill="url(#emberL)"/>
<rect width="{W}" height="{H}" fill="url(#emberR)"/>
{slashes("left")}
{slashes("right")}
<rect width="{W}" height="{H}" fill="url(#glow)"/>
<rect width="{W}" height="{H}" fill="url(#core)"/>
<g>{embers(rnd, 260, 420)}</g>
<rect width="{W}" height="{H}" fill="url(#vig)"/>
<rect y="{H * 0.55:.0f}" width="{W}" height="{H * 0.45:.0f}" fill="url(#floor)"/>
</svg>"""


def arena():
    rnd = random.Random(77)
    # Fațete: triunghiuri pe o grilă deformată, în nuanțe de bleumarin, oglindite față de centru (ca logo-ul).
    cols, rows = 16, 4
    pts = {}
    for i in range(cols + 1):
        for j in range(rows + 1):
            x = i * (CX / cols)
            y = j * (H / rows)
            if 0 < i < cols:
                x += rnd.uniform(-22, 22)
            if 0 < j < rows:
                y += rnd.uniform(-18, 18)
            pts[(i, j)] = (x, y)
    polys = []
    for i in range(cols):
        for j in range(rows):
            a, b, c, d = pts[(i, j)], pts[(i + 1, j)], pts[(i + 1, j + 1)], pts[(i, j + 1)]
            for tri in ((a, b, c), (a, c, d)) if (i + j) % 2 else ((a, b, d), (b, c, d)):
                near = sum(p[0] for p in tri) / 3 / CX  # 0 la marginea ecranului, 1 lângă logo
                light = 14 + near * 16 + rnd.uniform(-5, 5)
                fill = f"rgb({light * 0.78:.0f},{light * 0.95:.0f},{light * 1.45:.0f})"
                edge = rnd.random() < 0.16
                stroke = f' stroke="#DF390C" stroke-opacity="{rnd.uniform(0.25, 0.6) * near:.2f}" stroke-width="1"' if edge else ' stroke="#0b0f17" stroke-opacity="0.5" stroke-width="0.6"'
                for mirror in (False, True):
                    pp = [((W - p[0]) if mirror else p[0], p[1]) for p in tri]
                    dd = " ".join(f"{px:.1f},{py:.1f}" for px, py in pp)
                    polys.append(f'<polygon points="{dd}" fill="{fill}"{stroke}/>')
    beams = []
    for s in (1, -1):
        for off, w, op in ((40, 260, 0.10), (240, 120, 0.07), (420, 60, 0.06)):
            x0 = CX + s * 120
            p = [(x0, 0), (x0 + s * 40, 0), (x0 + s * (off + w), H), (x0 + s * off, H)]
            dd = " ".join(f"{px:.1f},{py:.1f}" for px, py in p)
            beams.append(f'<polygon points="{dd}" fill="url(#beam)" opacity="{op}"/>')
    extra = '<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8A3D"/><stop offset="1" stop-color="#DF390C" stop-opacity="0"/></linearGradient>'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
{defs(extra)}
<rect width="{W}" height="{H}" fill="#0e1320"/>
<g>{"".join(polys)}</g>
<g style="mix-blend-mode:screen">{"".join(beams)}</g>
<rect width="{W}" height="{H}" fill="url(#glow)" opacity="0.8"/>
<g>{embers(rnd, 70, 300)}</g>
<rect width="{W}" height="{H}" fill="url(#vig)"/>
<rect y="{H * 0.55:.0f}" width="{W}" height="{H * 0.45:.0f}" fill="url(#floor)"/>
</svg>"""


for name, fn in (("forja", forja), ("arena", arena)):
    with open(f"{name}.svg", "w", encoding="utf-8", newline="\n") as f:
        f.write(fn())
print("ok")
