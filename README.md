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

## 다국어 (en 기본 / ko / ja / id)
- 문구는 `data/i18n.json` 한 파일에서 관리. 언어 추가 = `languages`에 코드 추가 + `strings`에 같은 키 세트 복사 후 번역.
- 프로듀서 이름·곡 제목·장르는 번역하지 않는다 (`tracks.json` 값 그대로). 분위기 필터는 키(party 등)로 저장하고 화면에서만 번역.
- 선택한 언어는 브라우저에 저장되고 `?lang=ko` 로도 지정할 수 있다 (숏폼 설명란 링크를 나라별로 다르게 쓰기 좋다).

## 커뮤니티 / 회원 (ID + 비밀번호)
- 페이지: `community.html` (게시판 4개: lounge / share / producers / events, 글·댓글·🔥좋아요). 이메일·이름·전화번호는 받지 않는다.
- **데모 모드**: `config.js`가 비어 있으면 글/계정이 그 브라우저의 localStorage에만 저장된다 (공개되지 않음, 화면에 노란 배너 표시).
- **라이브 전환 (Supabase 무료 플랜, 약 10분)**
  1. supabase.com 에서 프로젝트 생성 (Region: Northeast Asia 등)
  2. Authentication → Providers → Email: **"Confirm email" 끄기** (ID를 내부용 가짜 이메일로 변환해서 쓰기 때문)
  3. SQL Editor 에 `supabase/schema.sql` 전체를 붙여넣고 Run
  4. Project Settings → API 의 `Project URL` 과 `anon public` 키를 `config.js` 에 입력 → push (service_role 키는 절대 넣지 않는다)
- 보안: 테이블은 RLS로 보호 (읽기=누구나, 쓰기/삭제=로그인한 본인 글만). 본문은 전부 이스케이프하며 http(s) 링크만 자동 링크.
- 알려진 한계: 비밀번호 분실 시 복구 불가(이메일을 안 받으므로). 스팸 방지는 클라이언트 쿨다운뿐 — 트래픽이 생기면 Cloudflare Turnstile 등 추가. 부적절한 글 삭제는 Supabase 대시보드(Table Editor)에서 한다.

## 보안·운영 설정 (적용 현황)
- **Supabase URL 설정**: Site URL = `https://kjuhoho.github.io/dropzone-site/`, Redirect URLs = `https://kjuhoho.github.io/dropzone-site/**` (적용됨). 커스텀 도메인을 붙이면 두 곳 모두 새 주소로 추가/변경.
- **DB 보강**: `supabase/002_hardening.sql` 적용됨 — 임시 닉네임(needs_username), `set_username`, `delete_my_account`, 서버측 스팸 제한(글 15초·일 30개, 댓글 4초·일 200개).
- **약관/개인정보**: `legal.html` (4개 언어). 가입 시 동의 체크 필수. 문의 이메일을 `config.js`의 `contact`에 넣으면 표시됨.
- **계정 삭제**: 로그인 후 상단 `@닉네임` → 계정 → 삭제 (글·댓글·좋아요 함께 삭제).

### 봇 차단 (Cloudflare Turnstile) — 사용자 계정 필요
1. dash.cloudflare.com → Turnstile → Add widget. Domain: `kjuhoho.github.io`, Mode: Managed.
2. **Site Key**(공개) → `config.js` 의 `turnstileSiteKey` 에 입력 후 push.
3. **Secret Key**(비공개) → Supabase → Authentication → Attack Protection → Enable CAPTCHA → Turnstile 선택 → Secret 입력 → Save. (Secret 은 코드/저장소에 절대 넣지 않는다)

### 구글 로그인 — 사용자 계정 필요
1. Google Cloud Console → 프로젝트 생성 → APIs & Services → OAuth consent screen (External, 앱 이름 DROPZONE, 지원 이메일).
2. Credentials → OAuth client ID → Web application. Authorized redirect URI: `https://zckhdueckqaleafhmkjl.supabase.co/auth/v1/callback`
3. Client ID / Secret → Supabase → Authentication → Sign In / Providers → Google → Enable → 저장. (Secret 은 Supabase 화면에만)
4. `config.js` 의 `googleLogin: true` 로 바꾸고 push.
5. 사용자가 늘면 동의 화면을 "Publish app" (그 전에는 Test users 로 등록한 계정만 로그인 가능).

## 운영 도구 / 소셜 / 통계 (DB 마이그레이션 001~006 적용 완료)
- `supabase/005_moderation.sql`: 신고 3건 누적 시 글·댓글 자동 숨김(관리자가 복원/삭제), 계정 정지(1/7/30일·영구), 가입 1시간 이내 신규 계정 작성 제한, 신고는 가입 1시간 후부터.
- `supabase/006_social_stats.sql`: 프로필(소개글·아바타 색), 팔로우, 알림(댓글·좋아요·팔로우), 익명 통계(`event_counts`).
- 관리자 화면: 커뮤니티 왼쪽 메뉴 🛡 Admin → 신고 / 정지 계정 / 통계. 관리자 지정: SQL Editor 에서 `insert into public.admins (user_id) select id from auth.users where lower(email)='<이메일>';` (이메일은 저장소에 커밋하지 않는다)
- **디스코드 신고 알림 (선택)**: 디스코드 서버 설정 → 연동 → 웹후크 생성 → URL 복사 →
  SQL Editor: `insert into public.app_settings (key, value) values ('discord_webhook', '<웹후크 URL>') on conflict (key) do update set value = excluded.value;`
  (URL 은 비밀값. 저장소/채팅에 올리지 않는다. 해제는 `delete from public.app_settings where key='discord_webhook';`)
- **곡별 공유 페이지**: `python scripts/build_pages.py` → `t/<slug>.html`(OG 미리보기), `sitemap.xml`, `robots.txt` 생성. `tracks.json` 을 바꿀 때마다 실행 후 커밋. 공유 버튼은 이 주소를 복사한다.
- **유입 추적**: 숏폼 설명란 링크에 `?src=tiktok` 처럼 붙이면 통계의 "유입 경로별 방문"에 집계된다. 쿠키·IP 저장 없음, 일별 카운터만 저장.

## 프로필 꾸미기 / 내 음원 (DB 마이그레이션 001~007 적용 완료)
- `supabase/007_profile_music.sql`: 프로필 아바타·배너(이미지 또는 색 스타일 8종)·링크 6종(https만)·소개글 300자, 프로필당 음원 5곡(`profile_tracks`), 음원 신고·자동 숨김.
- 내 프로필(`#/u/<닉네임>`) → **프로필 수정**(꾸미기) / **음원 올리기**(mp3·m4a·wav·ogg 12MB 이하, 커버 선택, "내가 만들었거나 공유할 권리가 있는 곡" 체크 필수). 전체 목록은 왼쪽 메뉴 🎧 Music(`#/music`).
- 관리자는 모든 음원 삭제 가능, 신고 3건이면 자동 숨김 → 관리자 화면에서 복원/삭제.
- 사진·음원은 Supabase Storage(`community` 버킷)에 저장된다. 무료 한도 약 1GB — 사용량을 가끔 확인.

## 곡 공개 정책 (중요)
- **사이트에는 전곡을 올리지 않는다.** 사이트의 대표곡은 75초 미리듣기만 공개(`media/audio/*-preview.mp3`, `tracks.json` 의 `preview: true`).
- 전곡은 아티스트 유튜브 채널로 안내한다: `tracks.json` 의 `producer.links.youtube`(또는 곡별 `links.youtube`)에 아티스트 채널 주소를 넣으면 곡 목록의 "미리듣기" 배지가 "유튜브에서 전곡 듣기 ↗" 링크로 바뀐다.
- 전곡 파일은 사이트 저장소 밖(`shorts/library/`)에 보관하며, 수익화 구조(유료/회원 전용 스트리밍 등)를 만들 때 사용한다.

## 빈 커뮤니티 채우기
1. 공식 계정으로 아이디 `dropzone` 가입(또는 구글 계정으로 가입 후 닉네임을 `dropzone` 으로 설정)
2. SQL Editor 에서 `supabase/seed_posts.sql` 실행 → 환영글(영/한) + 곡 공유·피드백·프로듀서·이벤트 시작 글 6개 생성. (한 번만 실행)
3. 프로필을 꾸민다: 사진 `media/brand/avatar-400.png`, 배너 `media/brand/profile-banner.png`, 소개문과 링크는 `brand/profile-kit.md` 참고.
