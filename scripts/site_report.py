"""DROPZONE 사이트 현황 보고서(한국어 마크다운). 읽기 전용.

  python scripts/site_report.py              # 사이트 + 유튜브 채널
  python scripts/site_report.py --no-youtube # 사이트만
  python scripts/site_report.py --json       # 원자료(JSON)

사이트 수치는 Supabase 의 site_report(키) 함수(supabase/008_report.sql)로 가져온다. 키는 shorts/secrets/site_report_key.txt (저장소에 올리지 않음).
쿠키·IP 없이 '방문 횟수'만 세는 익명 카운터라 순 방문자 수가 아니라 페이지 열람 횟수다(같은 탭에서 한 번만 센다).
유튜브 수치는 shorts/uploader.py 의 로그인(조회 권한)으로 가져온다.
"""
import argparse, collections, datetime as dt, json, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEY = ROOT / "shorts" / "secrets" / "site_report_key.txt"
CFG = Path(__file__).resolve().parents[1] / "config.js"


def supa():
    import re
    t = CFG.read_text(encoding="utf-8")
    return re.search(r'supabaseUrl:\s*"([^"]+)"', t)[1], re.search(r'supabaseKey:\s*"([^"]+)"', t)[1]


def fetch_site():
    url, anon = supa()
    if not KEY.exists():
        raise SystemExit(f"{KEY} 가 없습니다(사이트 보고 키).")
    req = urllib.request.Request(f"{url}/rest/v1/rpc/site_report", data=json.dumps({"k": KEY.read_text(encoding="utf-8").strip()}).encode(),
                                 headers={"apikey": anon, "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"사이트 데이터 조회 실패 {e.code}: {e.read().decode()[:200]}")


def fetch_youtube():
    sys.path.insert(0, str(ROOT / "shorts"))
    import uploader as U
    yt = U.service()
    ch = yt.channels().list(part="snippet,statistics", mine=True).execute()["items"][0]
    ids = [e["video_id"] for e in U.live_ledger()]
    vids = []
    for i in range(0, len(ids), 50):
        vids += yt.videos().list(part="snippet,statistics,status", id=",".join(ids[i:i + 50])).execute().get("items", [])
    return ch, vids


def table(rows, head):
    return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(x).replace("|", "/") for x in r) + " |" for r in rows])


def report(d, yt=None):
    today = dt.date.today()
    ev = d["events"]
    def total(days, typ, key=None):
        lo = (today - dt.timedelta(days=days)).isoformat()
        return sum(e["n"] for e in ev if e["day"] >= lo and e["type"] == typ and (key is None or e["key"] == key))
    L = [f"# DROPZONE 현황 ({today})", "",
         "> 방문 = 페이지 열람 횟수(익명 카운터, 순 방문자 수 아님). 곡 재생·공유도 횟수.", "",
         "## 요약", "",
         table([["방문", total(0, "visit"), total(6, "visit"), total(29, "visit")], ["곡 재생", total(0, "play"), total(6, "play"), total(29, "play")],
                ["곡 공유", total(0, "share"), total(6, "share"), total(29, "share")]], ["", "오늘", "최근 7일", "최근 30일"]), ""]
    m, p, c = d["members"], d["posts"], d["comments"]
    L += ["## 커뮤니티", "",
          f"- 회원 {m['total']}명 (최근 7일 +{m['last7']}, 30일 +{m['last30']})",
          f"- 글 {p['total']}개 (7일 +{p['last7']}, 30일 +{p['last30']}, 숨김 {p['hidden']}) · 댓글 {c['total']}개 (7일 +{c['last7']}) · 회원 업로드 음악 {d['user_tracks']}곡",
          f"- 처리 대기 신고 {d['reports_open']}건 · 정지 중 {d['bans_active']}명", ""]
    days = [(today - dt.timedelta(days=i)).isoformat() for i in range(13, -1, -1)]
    by = collections.defaultdict(lambda: collections.Counter())
    for e in ev:
        by[e["day"]][e["type"]] += e["n"]
    L += ["## 최근 14일 추이", "", table([[x[5:], by[x]["visit"], by[x]["play"], by[x]["share"]] for x in days], ["날짜", "방문", "재생", "공유"]), ""]
    lo = (today - dt.timedelta(days=29)).isoformat()
    for title, f, typ in (("유입 경로(최근 30일 방문, ?src=)", "src", "visit"), ("언어별 방문", "lang", "visit")):
        cnt = collections.Counter()
        for e in ev:
            if e["day"] >= lo and e["type"] == typ:
                cnt[e[f] or "(직접/없음)"] += e["n"]
        L += [f"## {title}", ""] + ([table(cnt.most_common(8), ["값", "횟수"]), ""] if cnt else ["- 아직 데이터 없음", ""])
    pl = collections.Counter()
    for e in ev:
        if e["day"] >= lo and e["type"] in ("play", "share"):
            pl[(e["key"], e["type"])] += e["n"]
    L += ["## 곡별 재생·공유(최근 30일)", ""] + ([table([[k, t, n] for (k, t), n in pl.most_common(10)], ["곡", "종류", "횟수"]), ""] if pl else ["- 아직 데이터 없음", ""])
    if d["posts_by_board"]:
        L += ["## 게시판별 글(30일)", "", table([[b["board"], b["n"]] for b in d["posts_by_board"]], ["게시판", "글"]), ""]
    if d["top_posts"]:
        L += ["## 인기 글(30일)", "", table([[t["title"], t["board"], "@" + t["username"], t["like_count"], t["comment_count"]] for t in d["top_posts"]], ["제목", "게시판", "작성", "좋아요", "댓글"]), ""]
    if yt:
        ch, vids = yt
        s = ch["statistics"]
        L += [f"## 유튜브 채널 {ch['snippet']['title']}", "",
              f"- 구독자 {s.get('subscriberCount', '숨김')} · 총 조회 {s.get('viewCount')} · 영상 {s.get('videoCount')}개", ""]
        pub = [v for v in vids if v["status"].get("privacyStatus") == "public"]
        wait = len(vids) - len(pub)
        L += [f"- 공개 {len(pub)}개 · 비공개/예약 {wait}개", ""]
        top = sorted(pub, key=lambda v: -int(v["statistics"].get("viewCount", 0)))[:5]
        if top:
            L += [table([[v["snippet"]["title"][:50], v["statistics"].get("viewCount", 0), v["statistics"].get("likeCount", 0)] for v in top], ["영상(조회 상위)", "조회", "좋아요"]), ""]
    return "\n".join(L)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--no-youtube", action="store_true"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    d = fetch_site()
    if a.json:
        print(json.dumps(d, ensure_ascii=False, indent=2)); sys.exit()
    yt = None
    if not a.no_youtube:
        try:
            yt = fetch_youtube()
        except BaseException as e:
            print(f"(유튜브 수치는 못 가져옴: {str(e)[:120]})", file=sys.stderr)
    sys.stdout.reconfigure(encoding="utf-8")
    print(report(d, yt))
