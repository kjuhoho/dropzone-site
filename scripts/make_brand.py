"""DROPZONE 홍보 프로필 이미지 생성: 아바타(1:1), 배너(3:1), OG 카드(1.91:1).
사용: python scripts/make_brand.py   → media/brand/ 에 PNG 저장
색상·로고 모양은 사이트(favicon / 네온 시안·마젠타)와 동일.
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "media" / "brand"
OUT.mkdir(parents=True, exist_ok=True)
BG = (7, 6, 13)
C1, C2 = (0, 240, 255), (255, 43, 214)
FONT = "C:/Windows/Fonts/bahnschrift.ttf"
FONT_B = "C:/Windows/Fonts/arialbd.ttf"


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, c1=C1, c2=C2, angle=0.0):
    """size 크기의 대각선 그라디언트 이미지"""
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    ca, sa = math.cos(angle), math.sin(angle)
    span = abs(w * ca) + abs(h * sa) or 1
    for y in range(h):
        for x in range(w):
            t = ((x - w / 2) * ca + (y - h / 2) * sa) / span + 0.5
            px[x, y] = lerp(c1, c2, min(1, max(0, t)))
    return img


def glow(layer, radius, strength=1.0):
    """RGBA 레이어에 번짐 효과를 더해 돌려준다"""
    blur = layer.filter(ImageFilter.GaussianBlur(radius))
    if strength != 1.0:
        a = blur.getchannel("A").point(lambda v: min(255, int(v * strength)))
        blur.putalpha(a)
    return Image.alpha_composite(blur, layer)


def bars_layer(size, n, seed, base_y, max_h, bar_w_ratio=0.62, floor=0.08):
    """이퀄라이저 막대(그라디언트) RGBA 레이어"""
    w, h = size
    rnd = random.Random(seed)
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    step = w / n
    for i in range(n):
        # 가운데가 높은 종 모양 + 랜덤
        env = math.exp(-((i - n / 2) / (n * 0.28)) ** 2)
        v = floor + (1 - floor) * env * (0.45 + 0.55 * rnd.random())
        bh = v * max_h
        x0 = i * step + step * (1 - bar_w_ratio) / 2
        d.rounded_rectangle([x0, base_y - bh, x0 + step * bar_w_ratio, base_y], radius=step * 0.2, fill=255)
    grad = gradient(size, C1, C2, angle=math.pi / 2)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    layer.paste(grad, (0, 0), mask)
    return layer


def logo_mark(size, stroke_ratio=0.16):
    """사이트 파비콘과 같은 '피크(Λ)' 마크. RGBA, size x size"""
    s = size
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    pts = [(s * 0.14, s * 0.80), (s * 0.50, s * 0.16), (s * 0.86, s * 0.80)]
    d.line(pts, fill=255, width=int(s * stroke_ratio), joint="curve")
    r = int(s * stroke_ratio / 2)
    for p in (pts[0], pts[2]):
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
    grad = gradient((s, s), C1, C2, angle=math.pi / 4)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(grad, (0, 0), m)
    return out


def text_gradient(text, font, spacing):
    """글자 사이 간격이 있는 그라디언트 텍스트 RGBA"""
    tmp = Image.new("L", (4000, 600), 0)
    d = ImageDraw.Draw(tmp)
    x = 10
    for ch in text:
        d.text((x, 10), ch, font=font, fill=255)
        x += d.textlength(ch, font=font) + spacing
    bbox = tmp.getbbox()
    m = tmp.crop(bbox)
    grad = gradient(m.size, C1, C2, angle=0.0)
    out = Image.new("RGBA", m.size, (0, 0, 0, 0))
    out.paste(grad, (0, 0), m)
    return out


def vignette(size, strength=0.65):
    w, h = size
    v = Image.new("L", size, 0)
    d = ImageDraw.Draw(v)
    d.ellipse([-w * 0.25, -h * 0.4, w * 1.25, h * 1.4], fill=255)
    v = v.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18))
    dark = Image.new("RGB", size, BG)
    return dark, ImageChops.invert(v).point(lambda x: int(x * strength))


def base(size):
    img = Image.new("RGB", size, BG)
    # 은은한 색 번짐 2개
    for (cx, cy, col, r) in [(0.18, 0.2, C1, 0.45), (0.85, 0.85, C2, 0.5)]:
        layer = Image.new("RGB", size, BG)
        d = ImageDraw.Draw(layer)
        R = int(max(size) * r)
        d.ellipse([size[0] * cx - R, size[1] * cy - R, size[0] * cx + R, size[1] * cy + R], fill=lerp(BG, col, 0.17))
        layer = layer.filter(ImageFilter.GaussianBlur(R * 0.55))
        img = ImageChops.screen(img, layer)
    return img


def paste_center(img, layer, cx, cy):
    img.paste(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)), layer)


# ---------------- 아바타 1024 (정사각, 원형으로 잘려도 안전) ----------------
def make_avatar(px=1024):
    img = base((px, px))
    bars = bars_layer((px, px), 15, seed=7, base_y=px * 0.80, max_h=px * 0.36, floor=0.05)
    bars.putalpha(bars.getchannel("A").point(lambda v: int(v * 0.35)))
    img = img.convert("RGBA")
    img = Image.alpha_composite(img, glow(bars, px * 0.01))
    mark = logo_mark(int(px * 0.58), 0.17)
    mark_glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(mark_glow, mark, px / 2, px * 0.46)
    img = Image.alpha_composite(img, glow(mark_glow, px * 0.02, 1.2))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, int(px * 0.085))
    word = text_gradient("DROPZONE", f, px * 0.016)
    paste_center(img, word, px / 2, px * 0.85)
    img.convert("RGB").save(OUT / "avatar.png", optimize=True)
    img.convert("RGB").resize((400, 400), Image.LANCZOS).save(OUT / "avatar-400.png", optimize=True)


# ---------------- 배너 1500x500 (SNS 공통), 프로필 배너 1200x400 ----------------
def make_banner(w=1500, h=500, name="banner.png", tagline=True):
    img = base((w, h)).convert("RGBA")
    bars = bars_layer((w, h), 64, seed=11, base_y=h * 1.0, max_h=h * 0.78, floor=0.06)
    bars.putalpha(bars.getchannel("A").point(lambda v: int(v * 0.55)))
    img = Image.alpha_composite(img, glow(bars, 5))
    # 가운데를 살짝 어둡게 해 글자 가독성 확보
    shade = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rounded_rectangle([w * 0.2, h * 0.16, w * 0.8, h * 0.84], radius=40, fill=(7, 6, 13, 150))
    img = Image.alpha_composite(img, shade.filter(ImageFilter.GaussianBlur(40)))
    mark = logo_mark(int(h * 0.30), 0.17)
    mk = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(mk, mark, w / 2, h * 0.29)
    img = Image.alpha_composite(img, glow(mk, 10, 1.2))
    f = ImageFont.truetype(FONT, int(h * 0.22))
    word = text_gradient("DROPZONE", f, h * 0.035)
    wl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(wl, word, w / 2, h * 0.58)
    img = Image.alpha_composite(img, glow(wl, 8, 0.9))
    if tagline:
        d = ImageDraw.Draw(img)
        tf = ImageFont.truetype(FONT, int(h * 0.062))
        t = "A PLACE FOR PEOPLE WHO LOVE EDM"
        tw = sum(d.textlength(c, font=tf) + h * 0.012 for c in t) - h * 0.012
        x = (w - tw) / 2
        for c in t:
            d.text((x, h * 0.76), c, font=tf, fill=(220, 216, 245, 235))
            x += d.textlength(c, font=tf) + h * 0.012
    img.convert("RGB").save(OUT / name, optimize=True)


# ---------------- OG 카드 1200x630 ----------------
def make_og():
    w, h = 1200, 630
    img = base((w, h)).convert("RGBA")
    bars = bars_layer((w, h), 52, seed=3, base_y=h * 1.0, max_h=h * 0.62, floor=0.05)
    bars.putalpha(bars.getchannel("A").point(lambda v: int(v * 0.5)))
    img = Image.alpha_composite(img, glow(bars, 4))
    mark = logo_mark(int(h * 0.36), 0.17)
    mk = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(mk, mark, w / 2, h * 0.28)
    img = Image.alpha_composite(img, glow(mk, 10, 1.2))
    f = ImageFont.truetype(FONT, int(h * 0.2))
    word = text_gradient("DROPZONE", f, h * 0.03)
    wl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(wl, word, w / 2, h * 0.58)
    img = Image.alpha_composite(img, glow(wl, 8, 0.9))
    d = ImageDraw.Draw(img)
    tf = ImageFont.truetype(FONT, int(h * 0.058))
    t = "A PLACE FOR PEOPLE WHO LOVE EDM"
    tw = sum(d.textlength(c, font=tf) + 6 for c in t) - 6
    x = (w - tw) / 2
    for c in t:
        d.text((x, h * 0.76), c, font=tf, fill=(225, 221, 248, 240))
        x += d.textlength(c, font=tf) + 6
    img.convert("RGB").save(OUT / "og.png", optimize=True)


# ---------------- 유튜브: 채널 배너 2560x1440 (안전영역 1546x423 가운데) ----------------
def make_youtube_banner(w=2560, h=1440):
    img = base((w, h)).convert("RGBA")
    # 가운데 가로선 기준 위아래 대칭 막대 (TV 화면 전체 대응, 글자 뒤에서는 약하게)
    up = bars_layer((w, h // 2), 96, seed=21, base_y=h // 2, max_h=h * 0.36, floor=0.05)
    up.putalpha(up.getchannel("A").point(lambda v: int(v * 0.42)))
    mir = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    mir.paste(up, (0, 0))
    mir.paste(up.transpose(Image.FLIP_TOP_BOTTOM), (0, h // 2))
    img = Image.alpha_composite(img, glow(mir, 6))
    cx, cy = w / 2, h / 2
    # 글자 가독성용 어두운 띠 (안전영역 안쪽)
    shade = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rounded_rectangle([cx - 700, cy - 190, cx + 700, cy + 190], radius=60, fill=(7, 6, 13, 165))
    img = Image.alpha_composite(img, shade.filter(ImageFilter.GaussianBlur(50)))
    mark = logo_mark(150, 0.17)
    mk = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(mk, mark, cx, cy - 118)
    img = Image.alpha_composite(img, glow(mk, 10, 1.2))
    f = ImageFont.truetype(FONT, 138)
    word = text_gradient("DROPZONE", f, 20)
    wl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(wl, word, cx, cy + 22)
    img = Image.alpha_composite(img, glow(wl, 9, 0.9))
    d = ImageDraw.Draw(img)
    tf = ImageFont.truetype(FONT, 40)
    t = "A PLACE FOR PEOPLE WHO LOVE EDM"
    tw = sum(d.textlength(c, font=tf) + 9 for c in t) - 9
    x = cx - tw / 2
    for c in t:
        d.text((x, cy + 105), c, font=tf, fill=(225, 221, 248, 240))
        x += d.textlength(c, font=tf) + 9
    img.convert("RGB").save(OUT / "youtube-banner.png", optimize=True)


# ---------------- 유튜브: 영상 워터마크 150x150 (투명 배경, 로고만) ----------------
def make_watermark():
    mark = logo_mark(150, 0.19)
    out = Image.new("RGBA", (150, 150), (0, 0, 0, 0))
    out.alpha_composite(mark)
    out.save(OUT / "youtube-watermark.png", optimize=True)


# ---------------- 유튜브: 채널 프로필 사진 800x800 ----------------
def make_youtube_avatar():
    Image.open(OUT / "avatar.png").resize((800, 800), Image.LANCZOS).save(OUT / "youtube-avatar.png", optimize=True)


# ---------------- 곡 커버(임시): 아티스트명 + 곡 번호. 실제 커버가 생기면 media/covers/ 의 같은 이름 파일을 교체 ----------------
def make_track_cover(artist="ARUGA", label="TRACK 01", out="aruga-track01.jpg", px=800):
    img = base((px, px)).convert("RGBA")
    bars = bars_layer((px, px), 28, seed=5, base_y=px * 0.98, max_h=px * 0.5, floor=0.05)
    bars.putalpha(bars.getchannel("A").point(lambda v: int(v * 0.5)))
    img = Image.alpha_composite(img, glow(bars, 4))
    mark = logo_mark(int(px * 0.34), 0.17)
    mk = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(mk, mark, px / 2, px * 0.30)
    img = Image.alpha_composite(img, glow(mk, 9, 1.2))
    f = ImageFont.truetype(FONT, int(px * 0.15))
    word = text_gradient(artist, f, px * 0.02)
    wl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    paste_center(wl, word, px / 2, px * 0.62)
    img = Image.alpha_composite(img, glow(wl, 7, 0.9))
    d = ImageDraw.Draw(img)
    tf = ImageFont.truetype(FONT, int(px * 0.05))
    tw = sum(d.textlength(c, font=tf) + 8 for c in label) - 8
    x = (px - tw) / 2
    for c in label:
        d.text((x, px * 0.74), c, font=tf, fill=(225, 221, 248, 240))
        x += d.textlength(c, font=tf) + 8
    cov = OUT.parent / "covers"; cov.mkdir(exist_ok=True)
    img.convert("RGB").save(cov / out, quality=90, optimize=True)


if __name__ == "__main__":
    make_avatar()
    make_banner()
    make_banner(1200, 400, "profile-banner.png", tagline=False)
    make_og()
    make_youtube_banner()
    make_watermark()
    make_youtube_avatar()
    make_track_cover()
    for p in sorted(OUT.glob("*.png")):
        print(p.name, Image.open(p).size, p.stat().st_size // 1024, "KB")
