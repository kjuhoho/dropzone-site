# DROPZONE 유튜브 채널 프로필 키트

## 1. 이미지 (media/brand/) — YouTube Studio → 맞춤 설정 → 브랜딩
| 파일 | 크기 | 업로드 위치 |
|---|---|---|
| `youtube-avatar.png` | 800×800 | 프로필 사진 (원형으로 표시됨, 로고·글자 모두 안전) |
| `youtube-banner.png` | 2560×1440 (6MB 이하) | 배너 이미지. 로고·문구가 **모든 기기 안전영역 1546×423 안**에 있음 (PC 2560×423 전체 / 휴대폰·TV 대응) |
| `youtube-watermark.png` | 150×150 투명 | 동영상 워터마크 (영상 우하단 구독 버튼). 표시 시점: 영상 끝 / 전체 |

다시 만들기: `python scripts/make_brand.py`

## 2. 기본 정보
- **채널 이름**: `DROPZONE`
- **핸들(@)**: `@dropzone.edm` → 없으면 `@dropzone_edm`, `@dropzoneedm`, `@dropzonehq` (다른 플랫폼과 같은 핸들이면 최고)
- **채널 설명(1,000자 이하, 글자 수 확인 완료)**: 맞춤 설정 → 기본 정보. 기본 언어는 영어, **"언어 추가"로 한국어·일본어·인도네시아어 번역을 넣으면** 시청자 언어에 맞춰 표시된다.

### EN (418자)
```
DROPZONE is a place for people who love EDM.

🎧 Original tracks — hear the full song behind the drop
🔥 Short clips — the best 20 seconds, every week
💬 Community — share tracks, get feedback, find festival friends (free, no email needed)

New here? Start with the Shorts, then hear the full track and join the conversation:
👉 https://kjuhoho.github.io/dropzone-site/?src=youtube

Business & copyright: kjuhoho@gnu.ac.kr
```
### KO (262자)
```
DROPZONE은 EDM을 사랑하는 사람들의 공간이에요.

🎧 오리지널 트랙 — 드롭 뒤에 숨은 전곡을 들어보세요
🔥 숏폼 — 매주 가장 짜릿한 20초
💬 커뮤니티 — 곡 공유, 피드백, 페스티벌 같이 갈 친구 찾기 (무료 · 이메일 없이 가입)

처음이라면 숏폼부터 보고, 전곡을 듣고, 이야기에 참여해 보세요:
👉 https://kjuhoho.github.io/dropzone-site/?src=youtube

비즈니스·저작권 문의: kjuhoho@gnu.ac.kr
```
### JA (259자)
```
DROPZONEは、EDMを愛する人たちのための場所です。

🎧 オリジナル曲 — ドロップの先にあるフルバージョンを聴こう
🔥 ショート動画 — 毎週、いちばん熱い20秒
💬 コミュニティ — 曲のシェア、フィードバック、フェス仲間探し(無料・メール不要)

はじめての方は、ショートを見て、フルで聴いて、会話に参加してみてください:
👉 https://kjuhoho.github.io/dropzone-site/?src=youtube

ビジネス・著作権のお問い合わせ: kjuhoho@gnu.ac.kr
```
### ID (417자)
```
DROPZONE adalah ruang untuk para pecinta EDM.

🎧 Lagu orisinal — dengarkan versi lengkap di balik drop-nya
🔥 Video pendek — 20 detik paling seru setiap minggu
💬 Komunitas — bagikan lagu, minta masukan, cari teman festival (gratis, tanpa email)

Baru di sini? Mulai dari Shorts, dengarkan lagu lengkapnya, lalu ikut ngobrol:
👉 https://kjuhoho.github.io/dropzone-site/?src=youtube

Bisnis & hak cipta: kjuhoho@gnu.ac.kr
```

## 3. 링크 (맞춤 설정 → 기본 정보 → 링크, 최대 14개 / 배너 위에는 앞쪽 5개가 표시)
1. DROPZONE — https://kjuhoho.github.io/dropzone-site/?src=youtube
2. Community — https://kjuhoho.github.io/dropzone-site/community.html?src=youtube
3. (생기면) Instagram · TikTok · X
- **비즈니스 문의 이메일**: kjuhoho@gnu.ac.kr (채널 소개 화면에 공개됨. 공개가 싫으면 이 칸을 비워 두기)

## 4. 업로드 기본값 (맞춤 설정 아님: 설정 → 업로드 기본 설정)
- 카테고리: **음악** · 라이선스: 표준 YouTube 라이선스 · 아동용 아님
- 태그: `edm, electronic dance music, original edm, new music, producer, drop, festival, rave, shorts`
- 일반 영상 설명 템플릿:
```
(곡 한 줄 소개)

🎧 Full track: https://kjuhoho.github.io/dropzone-site/t/<곡슬러그>.html?src=youtube
💬 Community: https://kjuhoho.github.io/dropzone-site/community.html?src=youtube

#EDM #ElectronicMusic #NewMusic #Drop #DropZone
```
- **쇼츠는 설명란 링크가 클릭되지 않는다.** → 쇼츠 설명에는 `LINK IN PROFILE`만 쓰고, 채널 링크(위 3번)와 **고정 댓글**에 주소를 넣는다. (영상 속 문구도 `LINK IN PROFILE` 로 통일)

## 5. 채널 홈 구성 (맞춤 설정 → 레이아웃)
1. **채널 트레일러(구독 전 시청자용)**: 30~60초, "DROPZONE이 뭔지 + 사이트 주소". 쇼츠 하이라이트 3개를 이어 붙여 제작.
2. **추천 섹션**: ① 인기 쇼츠 ② 최신 업로드 ③ 재생목록 — `Drops`(쇼츠 모음) · `Full Tracks`(전곡) · `Community`(커뮤니티 소개)
3. 구독자에게 맞는 **첫 영상 3개**: 쇼츠(드롭 하이라이트) → 전곡 영상 → "DROPZONE 커뮤니티 사용법" 짧은 안내.

## 6. 체크리스트 (직접 해야 하는 것)
- [ ] YouTube 채널 만들기 (브랜드 계정 권장: 나중에 다른 사람과 같이 관리 가능)
- [ ] 휴대폰 인증 (사용자 지정 썸네일, 링크 표시 등에 필요)
- [ ] 이미지 3개 업로드, 이름·핸들·설명(4개 언어)·링크 입력
- [ ] 업로드 기본 설정, 트레일러, 재생목록 3개 만들기
- [ ] 쇼츠는 `docs/youtube-upload-automation.md` 의 업로더(비공개+예약, 승인한 클립만)로 업로드 가능

## 7. 알아둘 점
- 수익화(YouTube 파트너 프로그램) 조건은 구독자·시청시간·쇼츠 조회수 기준이 있고 **자주 바뀌므로 시점에 맞춰 YouTube 고객센터에서 확인**한다. 음악은 직접 만든 곡만 쓰고, 샘플·루프의 라이선스를 확인한다.
- 같은 이름의 채널이 이미 있을 수 있다. 핸들이 사용 중이면 위 후보 중 비어 있는 것으로.
