"""곡별 공유 페이지(t/<slug>.html), sitemap.xml, robots.txt 생성.

카톡·SNS·검색엔진은 JS 를 실행하지 않으므로, 곡마다 OG 메타가 들어간 정적 페이지가 필요하다.
사람이 열면 JS 가 곧바로 메인 플레이어(index.html?t=<slug>)로 보낸다.

사용: python scripts/build_pages.py        (tracks.json 을 바꾼 뒤마다 실행하고 결과를 커밋)
"""
import json
from html import escape
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
data = json.loads((SITE / "data" / "tracks.json").read_text(encoding="utf-8"))
base = data["site"].get("url", "").rstrip("/") + "/"
if base == "/":
    raise SystemExit('data/tracks.json 의 site.url 을 채우세요 (예: "https://kjuhoho.github.io/dropzone-site/")')
artist = data["producer"]["name"]
site_name = data["site"]["name"]

TPL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — {artist} | {site}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="{site}">
<meta property="og:title" content="{title} — {artist}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{image}">
<meta property="og:audio" content="{audio}">
<meta property="og:audio:type" content="audio/mpeg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title} — {artist}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{image}">
<script type="application/ld+json">{ld}</script>
<meta name="theme-color" content="#07060d">
<style>body{{margin:0;background:#07060d;color:#f3f1ff;font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}}a{{color:#00f0ff}}img{{width:240px;height:240px;border-radius:16px;object-fit:cover}}</style>
</head>
<body>
<main>
  <img src="{image}" alt="">
  <h1>{title}</h1>
  <p>{artist} · {genre}</p>
  <p><a id="go" href="{player}">▶ Listen on {site}</a></p>
  <audio controls preload="none" src="{audio}"></audio>
</main>
<script>
  // 사람은 메인 플레이어로 이동 (?src=, ?lang= 같은 유입 정보는 그대로 전달)
  var q = location.search ? "&" + location.search.slice(1) : "";
  location.replace("../?t={slug}" + q);
</script>
</body>
</html>
"""

(SITE / "t").mkdir(exist_ok=True)
urls = [base, base + "community.html", base + "legal.html"]
for t in data["tracks"]:
    slug = t["slug"]
    url = f"{base}t/{slug}.html"
    desc = f'Listen to "{t["title"]}" by {artist} — original {t.get("genre") or "EDM"} on {site_name}.'
    ld = {"@context": "https://schema.org", "@type": "MusicRecording", "name": t["title"],
          "byArtist": {"@type": "MusicGroup", "name": artist}, "url": url, "image": base + t["cover"],
          "audio": {"@type": "AudioObject", "contentUrl": base + t["audio"], "encodingFormat": "audio/mpeg"}}
    html = TPL.format(title=escape(t["title"]), artist=escape(artist), site=escape(site_name), desc=escape(desc),
                      url=url, image=base + t["cover"], audio=base + t["audio"], genre=escape(t.get("genre") or "EDM"),
                      player=f"../?t={slug}", slug=slug, ld=json.dumps(ld, ensure_ascii=False).replace("</", "<\\/"))
    (SITE / "t" / f"{slug}.html").write_text(html, encoding="utf-8")
    urls.append(url)
    print("페이지:", url)

sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + \
     "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls) + "</urlset>\n"
(SITE / "sitemap.xml").write_text(sm, encoding="utf-8")
(SITE / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {base}sitemap.xml\n", encoding="utf-8")
print("sitemap.xml, robots.txt 생성 완료")
