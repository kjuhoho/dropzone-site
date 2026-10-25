# DROPZONE 홍보 프로필 키트

사이트: https://kjuhoho.github.io/dropzone-site/  ·  문의: kjuhoho@gnu.ac.kr

## 1. 이미지 (media/brand/)
| 파일 | 크기 | 용도 |
|---|---|---|
| `avatar.png` | 1024×1024 | 프로필 사진 (인스타·틱톡·유튜브·X·커뮤니티). 원형으로 잘려도 로고·글자가 안전 영역 안에 있음 |
| `avatar-400.png` | 400×400 | 용량 작은 버전 (커뮤니티 업로드용) |
| `banner.png` | 1500×500 | X·유튜브 채널 배너 (유튜브는 중앙 안전영역 1546×423 안에 로고·문구 위치) |
| `profile-banner.png` | 1200×400 | DROPZONE 커뮤니티 프로필 배너 |
| `og.png` | 1200×630 | 링크 공유 미리보기(사이트에 적용됨) |

다시 만들기: `python scripts/make_brand.py` (색·문구는 스크립트 상단에서 수정)

## 2. 소개문 (글자 수 확인 완료)
### 인스타그램·X 등 (150자 이하)
- **EN** (123자): A place for people who love EDM 🎧 Listen to original tracks, meet producers & join the community. Free · no email needed ⬇️
- **KO** (75자): EDM을 사랑하는 사람들의 공간 🎧 오리지널 트랙을 듣고, 프로듀서를 만나고, 커뮤니티에서 이야기해요. 무료 · 이메일 없이 가입 ⬇️
- **JA** (61자): EDMを愛する人たちの場所 🎧 オリジナル曲を聴いて、プロデューサーと出会い、コミュニティで語ろう。無料・メール不要 ⬇️
- **ID** (113자): Ruang untuk pecinta EDM 🎧 Dengarkan lagu orisinal, kenali produser, ngobrol di komunitas. Gratis · tanpa email ⬇️

### 틱톡 등 짧은 소개 (80자 이하)
- **EN** (48자): EDM lovers' hub 🎧 Original tracks + community ⬇️
- **KO** (31자): EDM 러버들의 공간 🎧 오리지널 트랙 + 커뮤니티 ⬇️
- **JA** (29자): EDMラバーの居場所 🎧 オリジナル曲＋コミュニティ ⬇️
- **ID** (49자): Markas pecinta EDM 🎧 Lagu orisinal + komunitas ⬇️

## 3. 프로필 링크 (유입 추적용 — 플랫폼마다 src 를 다르게)
| 플랫폼 | 링크 |
|---|---|
| 인스타그램 | https://kjuhoho.github.io/dropzone-site/?src=instagram |
| 틱톡 | https://kjuhoho.github.io/dropzone-site/?src=tiktok |
| 유튜브 | https://kjuhoho.github.io/dropzone-site/?src=youtube |
| X | https://kjuhoho.github.io/dropzone-site/?src=x |
| 인도네시아 대상 | https://kjuhoho.github.io/dropzone-site/?src=instagram&lang=id |
| 일본 대상 | https://kjuhoho.github.io/dropzone-site/?src=x&lang=ja |
링크를 열면 사이트 관리자 화면 → 통계 → "유입 경로별 방문"에 집계된다.

## 4. 계정 이름(핸들) 제안
`dropzone.edm` · `dropzone_edm` · `dropzoneedm` · `dropzone.hq` — 플랫폼 4곳에서 **같은 이름**이 비어 있는지 먼저 확인.
"DropZone"는 흔한 이름이라 이미 쓰는 곳이 많다. 이름을 굳히기 전에 상표·핸들 중복을 확인하고, 필요하면 사이트 이름을 `config`(data/tracks.json 의 site.name)에서 한 번에 바꿀 수 있다.

## 5. 해시태그 (게시물당 5~8개)
`#EDM #ElectronicMusic #NewMusic #MusicProducer #Festival #Drop #Rave #DropZone`
언어별 추가: KO `#일렉트로닉 #EDM추천` · JA `#EDM好きと繋がりたい` · ID `#musikelektronik #edmindonesia`

## 6. DROPZONE 공식 커뮤니티 계정
1. (사용자) 커뮤니티에서 공식 계정으로 가입 — 아이디 예: `dropzone` (구글 로그인도 가능)
2. 프로필: 사진 `avatar-400.png`, 배너 `profile-banner.png`, 소개문(위 EN/KO), 링크에 인스타·틱톡·유튜브 주소 입력 *(프로필 꾸미기 기능 배포 후)*
3. 첫 글(라운지에 올리고 고정 대신 맨 위 유지): 아래 환영글

### 환영글 초안
**EN** — *Welcome to DROPZONE 🎧* / This is a free home for people who love EDM. Share tracks you love or made (links or uploads you own), ask production questions, find people to go to festivals with. Be kind, keep it about the music. Say hi and tell us: what's the last drop that gave you chills? #welcome #edm

**KO** — *DROPZONE에 오신 걸 환영해요 🎧* / EDM을 좋아하는 사람들을 위한 무료 공간이에요. 좋아하는 곡이나 직접 만든 곡을 공유하고, 작곡 질문도 하고, 같이 페스티벌 갈 사람도 찾아보세요. 서로 존중하고 음악 이야기를 나눠요. 인사 남겨주세요 — 요즘 소름 돋았던 드롭은? #환영 #edm

## 7. 첫 2주 운영 제안 (숏폼 연계)
- 숏폼 설명란 링크 = 위 링크표(플랫폼별 src). 영상 속 문구는 `LINK IN PROFILE`로 통일.
- 주 3회 숏폼 업로드 + 업로드마다 커뮤니티 라운지에 "이번 주 드롭" 글 1개.
- 매주 1회 "피드백 요청" 게시판에 직접 작업물 올려서 다른 프로듀서의 참여 유도.
- 통계에서 어떤 src(틱톡/유튜브/…)와 언어가 방문·가입으로 이어지는지 보고 비중 조정.
