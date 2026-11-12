"""Generate the FireSocks logo: a sock with flames behind it.

Draws at 4x for antialiasing, then writes every branding asset Firefox needs.
Run: python firesocks_logo.py <branding_dir>
"""
import math, os, sys
from PIL import Image, ImageDraw

S = 4          # supersample
W = H = 512    # master size

def P(*pts):   # scale points to supersampled space
    return [(x * S, y * S) for x, y in pts]

def B(x0, y0, x1, y1):  # scaled bounding box
    return [x0 * S, y0 * S, x1 * S, y1 * S]

def flame(draw, base_x, base_y, w, h, lean=0.0, col=(0, 0, 0)):
    """Jagged flame tongue: two staggered tooth rows up a leaning column."""
    pts = [(base_x - w * 0.5, base_y)]
    n = 6
    for i in range(1, n + 1):  # left edge up
        t = i / n
        pts.append((base_x - w * 0.5 * (1 - t * 0.75) + lean * t + (w * 0.10 if i % 2 else 0),
                    base_y - h * t))
    pts.append((base_x + lean + w * 0.06, base_y - h - w * 0.12))  # tip
    for i in range(n - 1, -1, -1):  # right edge down
        t = i / n
        pts.append((base_x + w * 0.5 * (1 - t * 0.75) + lean * t - (w * 0.10 if i % 2 else 0),
                    base_y - h * t))
    pts.append((base_x + w * 0.5, base_y))
    draw.polygon(P(*pts), fill=col)

def flame_layered(draw, base_x, base_y, w, h, lean=0.0):
    flame(draw, base_x, base_y, w, h, lean, (227, 53, 11))        # deep orange
    flame(draw, base_x, base_y, w * 0.74, h * 0.80, lean * 0.8, (255, 122, 28))
    flame(draw, base_x, base_y, w * 0.46, h * 0.55, lean * 0.6, (255, 210, 63))

def sock(draw):
    white = (244, 242, 238); shade = (212, 207, 199); accent = (255, 107, 26)
    cuffc = (58, 62, 82); rib = (255, 107, 26)
    # foot: rounded horizontal part
    draw.rounded_rectangle(B(140, 330, 425, 448), radius=59 * S, fill=white)
    draw.ellipse(B(118, 330, 218, 448), fill=white)          # toe round
    # leg: vertical part
    draw.rounded_rectangle(B(300, 140, 430, 400), radius=40 * S, fill=white)
    # heel bulge (right side where leg meets foot)
    draw.ellipse(B(375, 330, 470, 425), fill=white)
    # shading: inner shadow along leg left + under foot
    draw.rounded_rectangle(B(300, 150, 322, 390), radius=10 * S, fill=shade)
    draw.rounded_rectangle(B(180, 420, 415, 448), radius=14 * S, fill=shade)
    # heel accent patch
    draw.pieslice(B(382, 338, 462, 418), start=300, end=90, fill=accent)
    # toe accent cap
    draw.pieslice(B(124, 342, 212, 436), start=90, end=270, fill=accent)
    # cuff on top of leg
    draw.rounded_rectangle(B(292, 62, 438, 172), radius=26 * S, fill=cuffc)
    for i in range(3):  # orange rib stripes
        y = 84 + i * 30
        draw.rounded_rectangle(B(300, y, 430, y + 12), radius=6 * S, fill=rib)

def logo(private=False):
    img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if private:  # purple disc behind everything
        d.ellipse(B(16, 16, 496, 496), fill=(59, 30, 84, 255))
    # flames — behind the sock
    flame_layered(d, 210, 340, 90, 230, lean=-60)   # left
    flame_layered(d, 250, 120, 70, 130, lean=-30)   # top-left crown
    flame_layered(d, 360, 95, 60, 110, lean=10)     # top
    flame_layered(d, 455, 120, 70, 140, lean=40)    # top-right crown
    flame_layered(d, 490, 330, 80, 200, lean=60)    # right
    sock(d)
    # small flame licking the toe
    flame_layered(d, 140, 330, 46, 70, lean=-25)
    return img.resize((W, H), Image.LANCZOS)

def save_png(img, path, size=None):
    out = img if size is None else img.resize((size, size), Image.LANCZOS)
    out.save(path)

def main(brand):
    master = logo(); private = logo(private=True)
    for n in (16, 22, 24, 32, 48, 64, 128, 256):
        save_png(master, os.path.join(brand, f"default{n}.png"), n)
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(os.path.join(brand, "firefox.ico"), sizes=ico_sizes)
    master.resize((64, 64), Image.LANCZOS).save(os.path.join(brand, "firefox64.ico"), sizes=[(64, 64)])
    for f in ("document.ico", "document_pdf.ico", "newtab.ico", "newwindow.ico"):
        master.save(os.path.join(brand, f), sizes=ico_sizes)
    private.save(os.path.join(brand, "pbmode.ico"), sizes=ico_sizes)
    for f, sz in (("PrivateBrowsing_150.png", 300), ("PrivateBrowsing_70.png", 140),
                  ("VisualElements_150.png", 300), ("VisualElements_70.png", 140)):
        save_png(private, os.path.join(brand, f), sz)
    c = os.path.join(brand, "content")
    save_png(master, os.path.join(c, "about-logo.png"), 192)
    save_png(master, os.path.join(c, "about-logo@2x.png"), 384)
    save_png(private, os.path.join(c, "about-logo-private.png"), 192)
    save_png(private, os.path.join(c, "about-logo-private@2x.png"), 384)
    abt = Image.new("RGB", (600, 472), (36, 38, 52))
    abt.paste(master.resize((420, 420), Image.LANCZOS), (90, 26), master.resize((420, 420), Image.LANCZOS))
    abt.save(os.path.join(c, "about.png"))
    # installer art
    Image.new("RGBA", (1440, 880), (20, 22, 34, 255)).save(os.path.join(brand, "background.png"))
    wh = Image.new("RGB", (150, 57), (240, 240, 242)); wh.paste(master.resize((52, 52), Image.LANCZOS), (8, 2), master.resize((52, 52), Image.LANCZOS))
    wh.save(os.path.join(brand, "wizHeader.bmp")); wh.save(os.path.join(brand, "wizHeaderRTL.bmp"))
    wz = Image.new("RGB", (164, 314), (240, 240, 242)); wz.paste(master.resize((140, 140), Image.LANCZOS), (12, 60), master.resize((140, 140), Image.LANCZOS))
    wz.save(os.path.join(brand, "wizWatermark.bmp"))
    for root, _, files in os.walk(os.path.join(brand, "msix")):
        for f in files:
            if f.endswith(".png"):
                im = Image.open(os.path.join(root, f))
                save_png(master, os.path.join(root, f), max(im.size))
    print("done")

if __name__ == "__main__":
    main(sys.argv[1])
