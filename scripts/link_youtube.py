"""사이트 숏폼 카드에 실제 유튜브 주소를 연결한다(읽기 전용 조회 + data/shorts.json 갱신).

사용:
  git -C .. pull --ff-only             # 게시 장부(done.json)를 최신으로
  python scripts/link_youtube.py            # 예행: 무엇이 연결되는지만 출력
  python scripts/link_youtube.py --apply    # data/shorts.json 의 external.youtube 갱신

연결 규칙
 - 숏폼 항목의 `source` = 원본 영상 id (`<곡폴더>__<파일명>`; 큐 릴리스의 id 와 같다).
   sync_shorts.py 에 `--source-slug <곡폴더>` 를 주면 자동으로 기록된다.
 - 게시 장부: ../shorts/cloud/done.json(GitHub 게시, id → video_id) 와 ../shorts/uploads.json(PC 시절 업로드).
 - 실제로 열리는 영상만 연결한다(유튜브 oEmbed 로 공개 여부 확인). 아직 게시되지 않은 영상은 건너뛰고, 다음에 다시 실행하면 연결된다.
"""
import argparse, json, urllib.error, urllib.parse, urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
ROOT = SITE.parent
DATA = SITE / "data" / "shorts.json"


def ledger():
    m = {}
    up = ROOT / "shorts" / "uploads.json"
    if up.exists():
        for x in json.loads(up.read_text(encoding="utf-8")):
            if x.get("video_id"):
                m[f"{x['slug']}__{x['file']}"] = x["video_id"]
    dn = ROOT / "shorts" / "cloud" / "done.json"
    if dn.exists():
        for x in json.loads(dn.read_text(encoding="utf-8")).get("done", []):
            if x.get("video_id"):
                m[x["id"]] = x["video_id"]
    return m


def playable(vid):
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(f"https://www.youtube.com/shorts/{vid}", safe="")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=20) as r:
            return r.status == 200
    except urllib.error.HTTPError:
        return False
    except Exception:
        return None  # 네트워크 문제: 판단 보류


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    db = json.loads(DATA.read_text(encoding="utf-8"))
    led = ledger()
    changed = linked = waiting = nosrc = 0
    for s in db["shorts"]:
        src = s.get("source")
        if not src:
            nosrc += 1
            print(f"  [원본 미기록] {s['id']}")
            continue
        vid = led.get(src)
        if not vid:
            waiting += 1
            print(f"  [게시 대기] {s['id']}  ({src})")
            continue
        ok = playable(vid)
        if ok is not True:
            print(f"  [열리지 않음/확인 불가] {s['id']}  {vid}  -> 연결 안 함")
            continue
        url = f"https://www.youtube.com/shorts/{vid}"
        ext = s.setdefault("external", {})
        if ext.get("youtube") != url:
            ext["youtube"] = url
            changed += 1
        linked += 1
        print(f"  [연결] {s['id']} -> {url}")
    print(f"연결 {linked}개(새로 바뀐 것 {changed}) · 게시 대기 {waiting} · 원본 미기록 {nosrc}")
    if a.apply and changed:
        DATA.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
        print("data/shorts.json 갱신")
    elif changed:
        print("(예행입니다. --apply 를 주면 저장합니다)")


if __name__ == "__main__":
    main()
