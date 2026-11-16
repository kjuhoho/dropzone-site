"""음원 + songlab 분석 결과 -> 사이트에 곡 등록(미리듣기 75초 + 커버 + tracks.json).

사용:
  python scripts/add_track.py --audio <음원> --analysis <song_analysis.json> \
      --slug aruga-satellite --title Satellite --released 2026-11-05 --moods drive,focus

하는 일
 1. 분석의 마디 격자에 맞춰 75초(마디 단위) 미리듣기 구간을 고른다.
    - 구간 시작은 마디 경계, 끝은 2.5초 페이드아웃, 드롭이 최소 한 개(되도록 둘 이상) 들어가게
    - 시작은 빌드업/섹션 시작에 가깝게, 첫 드롭은 시작 8~20초 뒤에 오게
 2. media/audio/<slug>-preview.mp3 (128k)
 3. media/covers/<slug>.jpg  (브랜드 양식 + 막대 = 이 곡 미리듣기의 에너지 윤곽)
 4. data/tracks.json 에 곡 추가(이미 있으면 갱신). 새 곡은 앞쪽(최신순)에 둔다.
전곡은 사이트에 올리지 않는다(정책).
"""
import argparse, json, math, subprocess, sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
FONT = "C:/Windows/Fonts/bahnschrift.ttf"
WIN = 75.0
FADE = 2.5


def pick_window(an):
    bar, beat, g, dur = an["tempo"]["bar"], an["tempo"]["beat"], an["grid"], an["duration"]
    b0 = g["t0"] + g.get("downbeat_phase", 0) * beat
    nb = int(WIN // bar)
    length = nb * bar
    drops = [s["start"] for s in an["sections"] if s["label"] == "drop"]
    # 섹션 경계 = 마디 경계에 맞춰져 있음. 드롭마다 컷 분석의 상승폭(jump_db)으로 가중치
    wt = {}
    for d in drops:
        near = min(an["cuts"], key=lambda c: abs(c["drop"] - d), default=None)
        j = near["jump_db"] if near and abs(near["drop"] - d) < 1.0 else 1.0
        wt[d] = 1.0 + min(j, 12.0) / 12.0
    starts = [s["start"] for s in an["sections"]]
    best = None
    k = -int(b0 // bar)
    while True:
        s = b0 + k * bar
        k += 1
        if s < 0:
            continue
        if s + length > dur + 0.01:
            break
        inwin = [d - s for d in drops if 7.0 <= d - s <= length - 10.0]
        if not inwin:
            continue
        sc = sum(wt[d] for d in drops if 7.0 <= d - s <= length - 10.0)
        if 8.0 <= inwin[0] <= 20.0:
            sc += 0.5
        if any(abs(s - t) < bar * 0.6 for t in starts):
            sc += 0.6
        sc -= s / 2000.0
        if best is None or sc > best[0]:
            best = (sc, s, inwin)
    if best is None:
        raise SystemExit("미리듣기에 넣을 드롭 구간을 찾지 못했습니다")
    _, s, inwin = best
    return s, length, [round(x) for x in inwin], nb


def make_preview(audio, start, length, out):
    out.parent.mkdir(parents=True, exist_ok=True)
    af = f"afade=t=in:st=0:d=0.02,afade=t=out:st={length - FADE:.3f}:d={FADE}"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(audio),
                    "-af", af, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", str(out)], check=True)


def make_cover(preview, title, out, variant):
    import numpy as np
    import librosa
    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    N = 800
    y, sr = librosa.load(str(preview), sr=22050, mono=True)
    nbars = 29
    seg = np.array_split(y, nbars)
    env = np.array([math.sqrt(float(np.mean(s ** 2)) + 1e-12) for s in seg])
    lo, hi = np.percentile(env, 5), np.percentile(env, 97)
    env = np.clip((env - lo) / max(1e-9, hi - lo), 0, 1)
    env = 0.06 + 0.94 * env ** 1.5

    # 배경: 네 모서리 색 보간(브랜드 팔레트). 곡마다 청록 빛이 드는 모서리만 다르다
    corners = {
        "tl": [(19, 56, 75), (26, 21, 44), (27, 21, 47), (60, 24, 70)],
        "tr": [(26, 21, 44), (19, 56, 75), (60, 24, 70), (27, 21, 47)],
        "bl": [(27, 21, 47), (60, 24, 70), (19, 56, 75), (26, 21, 44)],
        "br": [(24, 20, 44), (30, 24, 54), (22, 52, 70), (62, 26, 74)],
    }[variant]
    ys, xs = np.mgrid[0:N, 0:N] / (N - 1.0)
    tl, tr, bl, br = [np.array(c, float) for c in corners]
    img = (tl * ((1 - xs) * (1 - ys))[..., None] + tr * (xs * (1 - ys))[..., None]
           + bl * ((1 - xs) * ys)[..., None] + br * (xs * ys)[..., None])
    base = Image.fromarray(np.clip(img, 0, 255).astype("uint8"), "RGB").convert("RGBA")

    # 막대(에너지 윤곽)
    bars = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(bars)
    pitch, w = 27.6, 18
    x0 = (N - (nbars - 1) * pitch - w) / 2
    for i, v in enumerate(env):
        h = 34 + v * 235
        x = x0 + i * pitch
        d.rounded_rectangle([x, N - 15 - h, x + w, N - 15], radius=9, fill=(176, 46, 168, 96))
    base = Image.alpha_composite(base, bars)

    # ^ 마크 (선 굵은 둥근 끝, 시안→마젠타 그라데이션 + 은은한 빛)
    mark = Image.new("L", (N, N), 0)
    md = ImageDraw.Draw(mark)
    pts = [(300, 322), (400, 138), (500, 322)]
    md.line(pts, fill=255, width=46, joint="curve")
    for p in (pts[0], pts[1], pts[2]):
        md.ellipse([p[0] - 23, p[1] - 23, p[0] + 23, p[1] + 23], fill=255)
    gx = np.clip((np.arange(N)[None, :] - 275) / 250.0, 0, 1)
    gy = np.clip((np.arange(N)[:, None] - 120) / 220.0, 0, 1)
    t = np.clip(0.55 * gx + 0.45 * gy, 0, 1)
    c1, c2 = np.array([76, 184, 250], float), np.array([228, 62, 210], float)
    col = (c1 * (1 - t)[..., None] + c2 * t[..., None]).astype("uint8")
    glow = mark.filter(ImageFilter.GaussianBlur(14)).point(lambda v: int(v * 0.45))
    glow_rgba = Image.new("RGBA", (N, N), (90, 170, 255, 0))
    glow_rgba.putalpha(glow)
    base = Image.alpha_composite(base, glow_rgba)
    mk = Image.fromarray(col, "RGB").convert("RGBA")
    mk.putalpha(mark)
    base = Image.alpha_composite(base, mk)

    # 글자: ARUGA (시안→마젠타 그라데이션), 곡 제목(밝은 회색, 자간 넓게)
    def spaced(text, size, track):
        f = ImageFont.truetype(FONT, size)
        try:
            f.set_variation_by_name("SemiBold")
        except Exception:
            pass
        widths = [f.getlength(ch) for ch in text]
        total = sum(widths) + track * (len(text) - 1)
        return f, widths, total

    def draw_spaced(img_, text, size, track, cy, fill):
        f, widths, total = spaced(text, size, track)
        layer = Image.new("L", (N, N), 0)
        ld = ImageDraw.Draw(layer)
        x = (N - total) / 2
        for ch, wd in zip(text, widths):
            ld.text((x, cy), ch, font=f, fill=255, anchor="ls")
            x += wd + track
        if callable(fill):
            colr = fill(total)
        else:
            colr = Image.new("RGBA", (N, N), fill)
        colr.putalpha(layer)
        return Image.alpha_composite(img_, colr)

    def grad(total):
        gxx = np.clip((np.arange(N)[None, :] - (N - total) / 2) / max(1.0, total), 0, 1)
        a, b = np.array([0, 232, 255], float), np.array([255, 60, 214], float)
        arr = (a * (1 - gxx)[..., None] + b * gxx[..., None])
        arr = np.repeat(arr, N, axis=0).astype("uint8")
        return Image.fromarray(arr, "RGB").convert("RGBA")

    base = draw_spaced(base, "ARUGA", 112, 26, 545, grad)
    tsize = 44 if len(title) <= 12 else 38
    base = draw_spaced(base, title.upper(), tsize, 14, 625, (235, 230, 250, 235))
    out.parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(out, quality=90)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--analysis", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--released", required=True)
    ap.add_argument("--genre", default="EDM")
    ap.add_argument("--moods", default="party")
    ap.add_argument("--variant", default="tl", choices=["tl", "tr", "bl", "br"])
    ap.add_argument("--shorts", default="", help="쉼표로 구분한 숏폼 id(이미 sync_shorts.py 로 등록한 것)")
    ap.add_argument("--no-cover", action="store_true")
    a = ap.parse_args()

    an = json.loads(Path(a.analysis).read_text(encoding="utf-8"))
    start, length, drops, nb = pick_window(an)
    pv = SITE / "media" / "audio" / f"{a.slug}-preview.mp3"
    make_preview(a.audio, start, length, pv)
    print(f"{a.title}: BPM {an['tempo']['bpm']:.0f} | 미리듣기 {start:.2f}s부터 {nb}마디({length:.1f}s) | 드롭 {drops}")

    cover_rel = f"media/covers/{a.slug}.jpg"
    if not a.no_cover:
        make_cover(pv, a.title, SITE / cover_rel, a.variant)

    tj = SITE / "data" / "tracks.json"
    db = json.loads(tj.read_text(encoding="utf-8"))
    entry = {
        "slug": a.slug, "title": a.title, "genre": a.genre, "bpm": int(round(an["tempo"]["bpm"])),
        "released": a.released, "cover": cover_rel, "audio": f"media/audio/{a.slug}-preview.mp3",
        "preview": True, "drops": drops, "downloadable": False,
        "shorts": [s for s in a.shorts.split(",") if s], "links": {}, "producer": "aruga",
        "moods": [m for m in a.moods.split(",") if m], "fullTrack": "not-published",
    }
    old = next((t for t in db["tracks"] if t["slug"] == a.slug), None)
    if old:
        db["tracks"][db["tracks"].index(old)] = entry
    else:
        db["tracks"].insert(0, entry)
    db["tracks"].sort(key=lambda t: t["released"], reverse=True)  # 최신순(같은 날짜면 기존 순서 유지)
    tj.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    print("등록:", a.slug)


if __name__ == "__main__":
    main()
