# ARUGA 사이트

음원을 들려주고 숏폼으로 유입시키는 정적 사이트. 빌드 도구·서버·DB 없이 파일만으로 동작 → 호스팅 비용 0원.
숏폼 제작(`../shorts/`)과는 **독립 프로젝트**이며, 연결점은 아래 두 개뿐이다.

## 숏폼 시스템과의 연결점
1. **데이터 계약** — `data/tracks.json`(곡) ↔ `data/shorts.json`(영상). 숏폼의 `track` 값 = 곡의 `slug`.
2. **동기화 스크립트** — `python scripts/sync_shorts.py <shorts/output/아티스트> <track-slug>`
   영상을 웹용(406x720, ~2MB)으로 압축해 `media/shorts/`에 넣고 `shorts.json`에 등록한다.
3. **유입 링크** — 숏폼 설명/프로필 링크에 `https://<도메인>/?t=<slug>` 를 쓴다. 열면 그 곡이 로드되고 ▶ 한 번이면 재생.

## 새 곡 추가
1. 음원 mp3(128k 미리듣기 또는 풀버전)를 `media/audio/`, 커버(600x600 jpg)를 `media/covers/`에 넣는다.
2. `data/tracks.json`의 `tracks`에 항목 추가 (title, audio, cover, genre, bpm, slug).
3. 숏폼 생성 후 `sync_shorts.py` 실행 → 업로드한 뒤 `shorts.json`의 `external`에 YouTube/TikTok URL 기입.

## 로컬 실행
```
cd site
python -m http.server 8765   # http://localhost:8765
```

## 무료 호스팅 (권장: Cloudflare Pages)
| 항목 | 선택 | 무료 한도 |
|---|---|---|
| 사이트 | Cloudflare Pages (또는 GitHub Pages) | 무제한 대역폭, 파일당 25MB |
| 음원/영상 용량이 커지면 | Cloudflare R2 | 10GB 저장, 송신료 0원 |
| 방문 통계 | Cloudflare Web Analytics | 무료, 쿠키 없음 |
| 도메인 | `*.pages.dev` 로 시작 → 나중에 .com 구매 | 도메인 연 1.5~2만원만 유일한 비용 |

배포: GitHub에 push → Cloudflare Pages에서 repo 연결, 빌드 명령 없음, 출력 디렉터리 `site`.
GitHub Pages는 repo 1GB·사이트 1GB·월 100GB 대역폭 소프트 한도라 음원이 늘면 R2로 옮긴다.

## 서버 운영 관점 메모
- 지금은 서버가 없다 = 장애·보안·유지보수 부담이 거의 없다. 이 장점을 가능한 오래 유지한다.
- 음원은 **미리듣기(128k, 30~60초 또는 풀)** 만 공개. 고음질 원본은 비공개 보관, 판매/다운로드 단계에서만 제공.
- 핫링크로 대역폭이 새는 게 걱정되면 R2 앞에 Cloudflare 규칙으로 Referer 제한.

## 수익화 로드맵 (순서대로, 앞 단계가 끝나기 전에 뒤를 하지 않는다)
1. **트래픽 계측** — Web Analytics + 숏폼별 `?t=slug&src=tiktok` 로 어느 영상이 유입을 만드는지 본다.
2. **스트리밍 유통** — DistroKid 등으로 Spotify/Apple/YouTube Music 유통 → `tracks.json`의 `links`에 연결. 스트리밍 수익 + 사이트는 허브 역할.
3. **YouTube 파트너/Content ID** — 풀곡 영상 업로드, 쇼츠 수익.
4. **후원·구매** — Ko-fi/Buy Me a Coffee 버튼, Bandcamp·Gumroad로 WAV 판매 (서버 없이 링크만).
5. **라이선스 판매** — "유튜버/숏폼 크리에이터용 BGM" 라이선스 (Gumroad/Payhip). 숏폼 시스템의 타깃과 가장 잘 맞는 유료 모델.
6. **이메일 수집** — 신곡 알림 (Buttondown·Mailchimp 무료 플랜), 팬덤 자산.
7. 서버가 정말 필요해지는 시점(회원·결제 자체 처리)에만 Cloudflare Workers + D1 (무료 한도)로 확장.

주의: 저작권(샘플/루프 라이선스), 세금(사업자·종합소득세)은 전문가 확인 권장. 광고(AdSense)는 음악 사이트와 궁합이 낮고 UX를 해쳐서 권장하지 않는다.

## 다음 작업 후보
- 곡별 정적 페이지 생성(OG 미리보기 카드, 검색 노출) — 작은 Node/Python 빌드 스크립트
- 실제 음원/커버/SNS 링크 입력
- PWA(홈 화면 추가, 오프라인 미리듣기)
