-- 공식 계정 설정 (한 번만 실행): 관리자 계정의 닉네임을 `dropzone` 으로 바꾸고 시작 글 6개를 넣는다.
-- 되돌리기: update public.profiles set username = '<원래 닉네임>' where lower(username) = 'dropzone';

update public.profiles set username = 'dropzone'
where id in (select user_id from public.admins)
  and not exists (select 1 from public.profiles x where lower(x.username) = 'dropzone');

insert into public.posts (author, board, title, body, created_at)
select p.id, v.board, v.title, v.body, now() - (v.n * interval '20 minutes')
from public.profiles p
cross join (values
  (1, 'lounge',
   'Welcome to DROPZONE 🎧',
   $b$This is a free home for people who love EDM.

Share tracks you love or made, ask production questions, and find people to go to festivals with. Be kind, keep it about the music.

Say hi and tell us: what's the last drop that gave you chills? #welcome #edm$b$),
  (2, 'lounge',
   'DROPZONE에 오신 걸 환영해요 🎧',
   $b$EDM을 좋아하는 사람들을 위한 무료 공간이에요.

좋아하는 곡이나 직접 만든 곡을 공유하고, 작곡 질문도 하고, 같이 페스티벌 갈 사람도 찾아보세요. 서로 존중하고 음악 이야기를 나눠요.

인사 남겨주세요 — 요즘 소름 돋았던 드롭은? #환영 #edm$b$),
  (3, 'share',
   'Share a track you can''t stop replaying',
   $b$Drop a link (YouTube, SoundCloud, Spotify…) and tell us in one line why it hits. Your own tracks are welcome too — you can also upload up to 5 of your own tracks on your profile.

Format: Artist — Title + why you love it. #sharetracks #newmusic$b$),
  (4, 'feedback',
   'How feedback threads work here',
   $b$Post a work in progress (link or upload), say what kind of feedback you want — mix, arrangement, sound design, drop energy — and what you've already tried.

When you reply: one thing that works, one thing to try, be specific, be kind. #feedback #wip$b$),
  (5, 'producers',
   'Question of the week: how do you build a drop?',
   $b$What's your approach — tension from risers and silence, a big sub, a vocal chop, a sound that only appears once?

Share your trick (and a link if you can). Beginners: ask anything. #production #drop #sounddesign$b$),
  (6, 'events',
   'Festival season — where are you headed?',
   $b$Tell us which festivals and club nights you're going to, and look for people to go with. Include the city and the dates.

Please don't share personal contact details publicly — use replies here. #festival #rave$b$)
) as v(n, board, title, body)
where lower(p.username) = 'dropzone';
