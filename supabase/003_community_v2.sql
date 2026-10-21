-- 003: 커뮤니티 개편 — 게시판 8개로 확장 + 신고 테이블 + 정렬/조회용 인덱스
-- (이미 schema.sql, 002 를 적용한 DB 에 한 번 실행. 신규 설치는 schema.sql 에 포함되어 있음)

-- 1) 게시판 목록 확장
alter table public.posts drop constraint if exists posts_board_check;
alter table public.posts add constraint posts_board_check
  check (board in ('lounge','share','feedback','producers','gear','events','collab','memes'));

-- 2) 신고 (운영자만 Supabase 대시보드에서 조회. 일반 사용자는 넣기만 가능, 읽기 불가)
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post','comment')),
  target_id bigint not null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  unique (reporter, target_type, target_id)
);
alter table public.reports enable row level security;
drop policy if exists "report as self" on public.reports;
create policy "report as self" on public.reports for insert to authenticated with check (reporter = auth.uid());
grant insert on public.reports to authenticated;

-- 3) 인덱스 (최신순/인기순 조회, 작성자별 조회)
create index if not exists posts_created on public.posts (created_at desc);
create index if not exists posts_author_created on public.posts (author, created_at desc);
create index if not exists likes_post on public.likes (post_id);
