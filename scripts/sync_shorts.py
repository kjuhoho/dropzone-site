"""shorts/output/<아티스트>/ 의 숏폼을 웹 미리보기용으로 압축해 site/media/shorts 에 넣고 data/shorts.json 에 등록.

사용: python scripts/sync_shorts.py <shorts출력폴더> <track-slug> [--prefix aruga]
숏폼 제작(shorts/make_short.py)과 사이트는 이 스크립트 하나로만 연결된다.
"""
import argparse, json, re, subprocess
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
DATA = SITE / "data" / "shorts.json"

ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("track"); ap.add_argument("--prefix", default="aruga")
a = ap.parse_args()

db = json.loads(DATA.read_text(encoding="utf-8"))
known = {s["id"] for s in db["shorts"]}
out = SITE / "media" / "shorts"; out.mkdir(parents=True, exist_ok=True)
for f in sorted(Path(a.src).glob("short_*.mp4")):
    m = re.match(r"short_(\d+)_drop(\d+)s", f.stem)
    if not m: continue
    sid = f"{a.prefix}-{a.track}-{m[1]}" if a.track != "demo-drop" else f"{a.prefix}-{m[1]}"
    if sid in known: continue
    v, p = out / f"{sid}.mp4", out / f"{sid}.jpg"
    subprocess.run(["ffmpeg","-loglevel","error","-y","-i",str(f),"-vf","scale=406:720","-c:v","libx264","-crf","30","-preset","slow","-c:a","aac","-b:a","64k","-movflags","+faststart",str(v)],check=True)
    subprocess.run(["ffmpeg","-loglevel","error","-y","-ss","12","-i",str(f),"-frames:v","1","-vf","scale=406:720","-q:v","4",str(p)],check=True)
    db["shorts"].append({"id":sid,"track":a.track,"video":f"media/shorts/{sid}.mp4","poster":f"media/shorts/{sid}.jpg","dropAt":int(m[2]),"external":{}})
    print("추가:", sid)
DATA.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
