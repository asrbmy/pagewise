"""Generate the PNG icons used by the PWA manifest (run once; output is committed).

    python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw

TEAL = (15, 118, 110, 255)
WHITE = (255, 255, 255, 255)
MINT = (153, 246, 228, 255)
LIGHT = (94, 234, 212, 255)
AMBER = (245, 158, 11, 255)


def draw(size, maskable=False):
    scale = 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = s / 512.0

    def P(points):
        return [(x * k, y * k) for x, y in points]

    if maskable:
        d.rectangle([0, 0, s, s], fill=TEAL)
        # shrink artwork into the central safe zone (~80%)
        inner = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        di = ImageDraw.Draw(inner)
        art(di, k)
        inner = inner.resize((int(s * 0.74), int(s * 0.74)), Image.LANCZOS)
        off = (s - inner.width) // 2
        img.alpha_composite(inner, (off, off))
    else:
        d.rounded_rectangle([0, 0, s, s], radius=112 * k, fill=TEAL)
        art(d, k)
    return img.resize((size, size), Image.LANCZOS)


def art(d, k):
    def P(points):
        return [(x * k, y * k) for x, y in points]

    d.polygon(P([(160, 96), (296, 96), (376, 176), (376, 400), (352, 424), (160, 424), (136, 400), (136, 120)]), fill=WHITE)
    d.polygon(P([(296, 96), (296, 152), (320, 176), (376, 176)]), fill=MINT)
    d.rounded_rectangle([176 * k, 216 * k, 336 * k, 232 * k], radius=8 * k, fill=TEAL)
    d.rounded_rectangle([176 * k, 256 * k, 336 * k, 272 * k], radius=8 * k, fill=LIGHT)
    d.rounded_rectangle([176 * k, 296 * k, 288 * k, 312 * k], radius=8 * k, fill=LIGHT)
    d.polygon(P([(352, 336), (396, 292), (420, 316), (376, 360), (342, 370)]), fill=AMBER)


if __name__ == "__main__":
    draw(192).save("public/icon-192.png")
    draw(512).save("public/icon-512.png")
    draw(512, maskable=True).save("public/icon-maskable-512.png")
    draw(180).save("public/apple-touch-icon.png")
    print("icons written")
