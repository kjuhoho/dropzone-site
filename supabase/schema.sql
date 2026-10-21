-- DROPZONE 커뮤니티 스키마 (Supabase > SQL Editor 에 통째로 붙여넣고 Run)
-- 개인정보는 저장하지 않는다: 닉네임(ID)과 비밀번호 해시(Supabase Auth 내부)뿐.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  needs_username boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

-- 가입 시 프로필 자동 생성 (아래 002 블록의 handle_new_user 가 최종 정의)
create function public.handle_new_user() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.posts (
  id bigint generated always as identity primary key,
  board text not null check (board in ('lounge','share','feedback','producers','gear','events','collab','memes')),
  author uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index posts_board_created on public.posts (board, created_at desc);

create table public.comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts(id) on delete cascade,
  author uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index comments_post on public.comments (post_id, created_at);

create table public.likes (
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (post_id, user_id)
);

-- 읽기용 뷰 (작성자 닉네임, 집계 포함). RLS 가 그대로 적용되도록 security_invoker
create view public.posts_feed with (security_invoker = true) as
  select p.id, p.board, p.title, p.body, p.created_at, p.author, pr.username,
         (select count(*) from public.likes l where l.post_id = p.id)    as like_count,
         (select count(*) from public.comments c where c.post_id = p.id) as comment_count
  from public.posts p join public.profiles pr on pr.id = p.author;

create view public.comments_feed with (security_invoker = true) as
  select c.id, c.post_id, c.body, c.created_at, c.author, pr.username
  from public.comments c join public.profiles pr on pr.id = c.author;

-- RLS: 읽기는 누구나, 쓰기/삭제는 로그인한 본인 것만
alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.comments enable row level security;
alter table public.likes    enable row level security;

create policy "read profiles"  on public.profiles for select using (true);
create policy "read posts"     on public.posts    for select using (true);
create policy "read comments"  on public.comments for select using (true);
create policy "read likes"     on public.likes    for select using (true);

create policy "write own post"    on public.posts    for insert to authenticated with check (author = auth.uid());
create policy "write own comment" on public.comments for insert to authenticated with check (author = auth.uid());
create policy "write own like"    on public.likes    for insert to authenticated with check (user_id = auth.uid());

create policy "delete own post"    on public.posts    for delete to authenticated using (author = auth.uid());
create policy "delete own comment" on public.comments for delete to authenticated using (author = auth.uid());
create policy "delete own like"    on public.likes    for delete to authenticated using (user_id = auth.uid());

-- 테이블 권한 명시 ("Automatically expose new tables" 를 꺼도 동작하도록)
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.posts, public.comments, public.likes to anon, authenticated;
grant select on public.posts_feed, public.comments_feed to anon, authenticated;
grant insert, delete on public.posts, public.comments, public.likes to authenticated;


-- ===== 002 블록 (구글 로그인 대비 / 계정 삭제 / 스팸 제한) =====
-- 1) 닉네임 없이 가입(구글 등)해도 프로필이 만들어지도록: 임시 닉네임 + needs_username 표시
alter table public.profiles add column if not exists needs_username boolean not null default false;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text := new.raw_user_meta_data->>'username';
begin
  if u is null or u !~ '^[A-Za-z0-9_]{3,20}$' then
    insert into public.profiles (id, username, needs_username)
      values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 10), true);
  else
    insert into public.profiles (id, username) values (new.id, u);
  end if;
  return new;
end $$;

-- 2) 임시 닉네임을 본인이 한 번만 정할 수 있는 함수
create or replace function public.set_username(new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  if new_name !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'bad_username'; end if;
  update public.profiles set username = new_name, needs_username = false
    where id = auth.uid() and needs_username;
  if not found then raise exception 'not_allowed'; end if;
end $$;
revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- 3) 계정 삭제 (프로필·글·댓글·좋아요는 cascade 로 함께 삭제)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 4) 서버측 스팸 제한 (클라이언트 우회 방지)
create or replace function public.limit_posts() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.posts where author = new.author and created_at > now() - interval '15 seconds') then
    raise exception 'rate_limit';
  end if;
  if (select count(*) from public.posts where author = new.author and created_at > now() - interval '1 day') >= 30 then
    raise exception 'daily_limit';
  end if;
  return new;
end $$;
drop trigger if exists posts_rate on public.posts;
create trigger posts_rate before insert on public.posts for each row execute function public.limit_posts();

create or replace function public.limit_comments() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.comments where author = new.author and created_at > now() - interval '4 seconds') then
    raise exception 'rate_limit';
  end if;
  if (select count(*) from public.comments where author = new.author and created_at > now() - interval '1 day') >= 200 then
    raise exception 'daily_limit';
  end if;
  return new;
end $$;
drop trigger if exists comments_rate on public.comments;
create trigger comments_rate before insert on public.comments for each row execute function public.limit_comments();


-- ===== 003 블록 (신고 테이블 / 인덱스) =====
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
