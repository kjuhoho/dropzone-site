-- DROPZONE 커뮤니티 스키마 (Supabase > SQL Editor 에 통째로 붙여넣고 Run)
-- 개인정보는 저장하지 않는다: 닉네임(ID)과 비밀번호 해시(Supabase Auth 내부)뿐.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

-- 가입 시 user_metadata.username 으로 프로필 자동 생성
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data->>'username');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.posts (
  id bigint generated always as identity primary key,
  board text not null check (board in ('lounge','share','producers','events')),
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

grant select on public.posts_feed, public.comments_feed to anon, authenticated;
