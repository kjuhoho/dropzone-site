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


-- ===== 004 블록 (첨부 / 관리자 / 저장소). 관리자 지정은 README 참고 =====
-- 1) 글 첨부 정보 (최대 5개: 사진 4 + 음원 1 은 클라이언트에서 제한, 서버는 개수만 제한)
alter table public.posts add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.posts drop constraint if exists posts_attachments_check;
alter table public.posts add constraint posts_attachments_check
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5);

create or replace view public.posts_feed with (security_invoker = true) as
  select p.id, p.board, p.title, p.body, p.created_at, p.author, pr.username,
         (select count(*) from public.likes l where l.post_id = p.id)    as like_count,
         (select count(*) from public.comments c where c.post_id = p.id) as comment_count,
         p.attachments
  from public.posts p join public.profiles pr on pr.id = p.author;

-- 2) 관리자
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- 정책 없음 = 클라이언트에서 접근 불가

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- 관리자는 모든 글/댓글 삭제, 신고 조회/삭제 가능
drop policy if exists "admin delete post" on public.posts;
create policy "admin delete post" on public.posts for delete to authenticated using (public.is_admin());
drop policy if exists "admin delete comment" on public.comments;
create policy "admin delete comment" on public.comments for delete to authenticated using (public.is_admin());
drop policy if exists "admin read reports" on public.reports;
create policy "admin read reports" on public.reports for select to authenticated using (public.is_admin());
drop policy if exists "admin delete reports" on public.reports;
create policy "admin delete reports" on public.reports for delete to authenticated using (public.is_admin());
grant select, delete on public.reports to authenticated;

create or replace view public.reports_feed with (security_invoker = true) as
  select r.id, r.target_type, r.target_id, r.reason, r.created_at, pr.username as reporter_name,
         case when r.target_type = 'post'
              then (select left(p.title || ' — ' || p.body, 300) from public.posts p where p.id = r.target_id)
              else (select left(c.body, 300) from public.comments c where c.id = r.target_id) end as preview,
         case when r.target_type = 'post'
              then (select p.attachments from public.posts p where p.id = r.target_id) else null end as attachments,
         case when r.target_type = 'comment'
              then (select c.post_id from public.comments c where c.id = r.target_id) else r.target_id end as post_id
  from public.reports r join public.profiles pr on pr.id = r.reporter;
grant select on public.reports_feed to authenticated;

-- 3) 업로드 저장소 (공개 읽기, 본인 폴더에만 업로드, 하루 25개 제한, 파일당 12MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 12582912,
        array['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/webm'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "community upload own folder" on storage.objects;
create policy "community upload own folder" on storage.objects for insert to authenticated with check (
  bucket_id = 'community'
  and (storage.foldername(name))[1] = auth.uid()::text
  and (select count(*) from storage.objects o
        where o.bucket_id = 'community'
          and (storage.foldername(o.name))[1] = auth.uid()::text
          and o.created_at > now() - interval '1 day') < 25);

drop policy if exists "community list own or admin" on storage.objects;
create policy "community list own or admin" on storage.objects for select to authenticated using (
  bucket_id = 'community' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "community delete own or admin" on storage.objects;
create policy "community delete own or admin" on storage.objects for delete to authenticated using (
  bucket_id = 'community' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));


-- ===== 005 블록 (운영 도구) =====


-- 0) 정책에서 is_admin() 을 호출하므로 anon 도 실행 가능해야 한다 (로그인 안 하면 false 만 반환)
grant execute on function public.is_admin() to anon;

-- 1) 숨김 플래그 (신고 3건 누적 시 자동 숨김 → 관리자가 복원/삭제)
alter table public.posts    add column if not exists hidden boolean not null default false;
alter table public.comments add column if not exists hidden boolean not null default false;

drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts for select using (not hidden or author = auth.uid() or public.is_admin());
drop policy if exists "read comments" on public.comments;
create policy "read comments" on public.comments for select using (not hidden or author = auth.uid() or public.is_admin());

drop policy if exists "admin update post" on public.posts;
create policy "admin update post" on public.posts for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin update comment" on public.comments;
create policy "admin update comment" on public.comments for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant update (hidden) on public.posts to authenticated;
grant update (hidden) on public.comments to authenticated;

-- 2) 정지(ban)
create table if not exists public.bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until timestamptz,                       -- null = 영구
  reason text check (reason is null or char_length(reason) <= 200),
  banned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.bans enable row level security;
drop policy if exists "admin read bans" on public.bans;
create policy "admin read bans" on public.bans for select to authenticated using (public.is_admin());
grant select on public.bans to authenticated;

create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bans where user_id = auth.uid() and (until is null or until > now()))
$$;
revoke all on function public.is_banned() from public, anon;
grant execute on function public.is_banned() to authenticated;

create or replace function public.my_ban() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('until', b.until, 'reason', b.reason)
  from public.bans b where b.user_id = auth.uid() and (b.until is null or b.until > now()) limit 1
$$;
revoke all on function public.my_ban() from public, anon;
grant execute on function public.my_ban() to authenticated;

create or replace function public.admin_ban(target uuid, days int default null, why text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if exists (select 1 from public.admins where user_id = target) then raise exception 'cannot_ban_admin'; end if;
  insert into public.bans (user_id, until, reason, banned_by)
  values (target, case when days is null or days <= 0 then null else now() + make_interval(days => days) end, left(why, 200), auth.uid())
  on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, banned_by = excluded.banned_by, created_at = now();
end $$;
revoke all on function public.admin_ban(uuid, int, text) from public, anon;
grant execute on function public.admin_ban(uuid, int, text) to authenticated;

create or replace function public.admin_unban(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  delete from public.bans where user_id = target;
end $$;
revoke all on function public.admin_unban(uuid) from public, anon;
grant execute on function public.admin_unban(uuid) to authenticated;

create or replace view public.bans_feed with (security_invoker = true) as
  select b.user_id, pr.username, b.until, b.reason, b.created_at
  from public.bans b join public.profiles pr on pr.id = b.user_id;
grant select on public.bans_feed to authenticated;

-- 3) 쓰기 정책에 "정지 아님" 조건 추가 (+ 신고는 가입 1시간 이상 계정만)
drop policy if exists "write own post" on public.posts;
create policy "write own post" on public.posts for insert to authenticated
  with check (author = auth.uid() and not public.is_banned());
drop policy if exists "write own comment" on public.comments;
create policy "write own comment" on public.comments for insert to authenticated
  with check (author = auth.uid() and not public.is_banned());
drop policy if exists "write own like" on public.likes;
create policy "write own like" on public.likes for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned());
drop policy if exists "report as self" on public.reports;
create policy "report as self" on public.reports for insert to authenticated
  with check (reporter = auth.uid() and not public.is_banned()
    and (select pr.created_at from public.profiles pr where pr.id = auth.uid()) < now() - interval '1 hour');

drop policy if exists "community upload own folder" on storage.objects;
create policy "community upload own folder" on storage.objects for insert to authenticated with check (
  bucket_id = 'community'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not public.is_banned()
  and (select count(*) from storage.objects o
        where o.bucket_id = 'community'
          and (storage.foldername(o.name))[1] = auth.uid()::text
          and o.created_at > now() - interval '1 day') < 25);

-- 4) 신규 계정 제한 (가입 1시간 이내: 글 3개 / 댓글 10개까지) — 기존 제한 함수 교체
create or replace function public.limit_posts() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.posts where author = new.author and created_at > now() - interval '15 seconds') then
    raise exception 'rate_limit';
  end if;
  if (select count(*) from public.posts where author = new.author and created_at > now() - interval '1 day') >= 30 then
    raise exception 'daily_limit';
  end if;
  if (select pr.created_at from public.profiles pr where pr.id = new.author) > now() - interval '1 hour'
     and (select count(*) from public.posts where author = new.author) >= 3 then
    raise exception 'new_account_limit';
  end if;
  return new;
end $$;

create or replace function public.limit_comments() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.comments where author = new.author and created_at > now() - interval '4 seconds') then
    raise exception 'rate_limit';
  end if;
  if (select count(*) from public.comments where author = new.author and created_at > now() - interval '1 day') >= 200 then
    raise exception 'daily_limit';
  end if;
  if (select pr.created_at from public.profiles pr where pr.id = new.author) > now() - interval '1 hour'
     and (select count(*) from public.comments where author = new.author) >= 10 then
    raise exception 'new_account_limit';
  end if;
  return new;
end $$;

-- 5) 디스코드 알림 + 자동 숨김
create extension if not exists pg_net with schema extensions;

create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;   -- 정책 없음 = 클라이언트 접근 불가

create or replace function public.notify_discord(msg text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare url text;
begin
  select value into url from public.app_settings where key = 'discord_webhook';
  if url is null or url = '' then return; end if;
  perform net.http_post(
    url := url,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('content', left(msg, 1800), 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)));
exception when others then null;   -- 알림 실패가 신고 저장을 막지 않도록
end $$;
revoke all on function public.notify_discord(text) from public, anon, authenticated;

create or replace function public.on_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; who text; txt text; site text;
begin
  select count(*) into n from public.reports where target_type = new.target_type and target_id = new.target_id;
  if n >= 3 then
    if new.target_type = 'post' then update public.posts set hidden = true where id = new.target_id;
    else update public.comments set hidden = true where id = new.target_id; end if;
  end if;
  select username into who from public.profiles where id = new.reporter;
  txt := case when new.target_type = 'post'
              then (select left(p.title || ' — ' || p.body, 200) from public.posts p where p.id = new.target_id)
              else (select left(c.body, 200) from public.comments c where c.id = new.target_id) end;
  select value into site from public.app_settings where key = 'site_url';
  perform public.notify_discord(
    '🚩 New report (' || new.target_type || ' #' || new.target_id || ', ' || n || ' total' || case when n >= 3 then ', auto-hidden' else '' end || ')' || E'\n'
    || 'by @' || coalesce(who, '?') || E'\n> ' || replace(coalesce(txt, '(deleted)'), E'\n', ' ') || E'\n'
    || coalesce(site || '#/admin', ''));
  return new;
end $$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert after insert on public.reports for each row execute function public.on_report();

-- 6) 읽기용 뷰에 hidden 추가 / 신고 뷰에 작성자 정보 추가 (컬럼은 항상 맨 뒤에 추가)
create or replace view public.posts_feed with (security_invoker = true) as
  select p.id, p.board, p.title, p.body, p.created_at, p.author, pr.username,
         (select count(*) from public.likes l where l.post_id = p.id)    as like_count,
         (select count(*) from public.comments c where c.post_id = p.id) as comment_count,
         p.attachments, p.hidden
  from public.posts p join public.profiles pr on pr.id = p.author;

create or replace view public.comments_feed with (security_invoker = true) as
  select c.id, c.post_id, c.body, c.created_at, c.author, pr.username, c.hidden
  from public.comments c join public.profiles pr on pr.id = c.author;

create or replace view public.reports_feed with (security_invoker = true) as
  select r.id, r.target_type, r.target_id, r.reason, r.created_at, pr.username as reporter_name,
         case when r.target_type = 'post'
              then (select left(p.title || ' — ' || p.body, 300) from public.posts p where p.id = r.target_id)
              else (select left(c.body, 300) from public.comments c where c.id = r.target_id) end as preview,
         case when r.target_type = 'post'
              then (select p.attachments from public.posts p where p.id = r.target_id) else null end as attachments,
         case when r.target_type = 'comment'
              then (select c.post_id from public.comments c where c.id = r.target_id) else r.target_id end as post_id,
         case when r.target_type = 'post'
              then (select p.author from public.posts p where p.id = r.target_id)
              else (select c.author from public.comments c where c.id = r.target_id) end as target_author,
         (select x.username from public.profiles x where x.id = case when r.target_type = 'post'
              then (select p.author from public.posts p where p.id = r.target_id)
              else (select c.author from public.comments c where c.id = r.target_id) end) as target_author_name,
         case when r.target_type = 'post'
              then (select p.hidden from public.posts p where p.id = r.target_id)
              else (select c.hidden from public.comments c where c.id = r.target_id) end as target_hidden
  from public.reports r join public.profiles pr on pr.id = r.reporter;
grant select on public.reports_feed, public.posts_feed, public.comments_feed to authenticated;
grant select on public.posts_feed, public.comments_feed to anon;


-- ===== 006 블록 (프로필/알림/통계) =====


-- 1) 프로필 확장: 소개글, 아바타 색상(0~359 hue). 닉네임은 수정 불가(컬럼 단위 권한)
alter table public.profiles add column if not exists bio text check (bio is null or char_length(bio) <= 160);
alter table public.profiles add column if not exists accent smallint check (accent is null or accent between 0 and 359);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant update (bio, accent) on public.profiles to authenticated;

-- 2) 팔로우
create table if not exists public.follows (
  follower uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  followee uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee on public.follows (followee);
alter table public.follows enable row level security;
drop policy if exists "read follows" on public.follows;
create policy "read follows" on public.follows for select using (true);
drop policy if exists "follow as self" on public.follows;
create policy "follow as self" on public.follows for insert to authenticated with check (follower = auth.uid() and not public.is_banned());
drop policy if exists "unfollow as self" on public.follows;
create policy "unfollow as self" on public.follows for delete to authenticated using (follower = auth.uid());
grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;

create or replace view public.profile_stats with (security_invoker = true) as
  select p.id, p.username, p.bio, p.accent, p.created_at,
         (select count(*) from public.posts x where x.author = p.id)       as posts_count,
         (select count(*) from public.follows f where f.followee = p.id)   as followers,
         (select count(*) from public.follows f where f.follower = p.id)   as following
  from public.profiles p;
grant select on public.profile_stats to anon, authenticated;

-- 피드 뷰에 작성자 아바타 색상 추가 (컬럼은 맨 뒤에)
create or replace view public.posts_feed with (security_invoker = true) as
  select p.id, p.board, p.title, p.body, p.created_at, p.author, pr.username,
         (select count(*) from public.likes l where l.post_id = p.id)    as like_count,
         (select count(*) from public.comments c where c.post_id = p.id) as comment_count,
         p.attachments, p.hidden, pr.accent
  from public.posts p join public.profiles pr on pr.id = p.author;
create or replace view public.comments_feed with (security_invoker = true) as
  select c.id, c.post_id, c.body, c.created_at, c.author, pr.username, c.hidden, pr.accent
  from public.comments c join public.profiles pr on pr.id = c.author;
grant select on public.posts_feed, public.comments_feed to anon, authenticated;

-- 3) 알림 (댓글 / 좋아요 / 팔로우)
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,   -- 받는 사람
  actor uuid not null references public.profiles(id) on delete cascade,     -- 행동한 사람
  type text not null check (type in ('comment','like','follow')),
  post_id bigint references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  read boolean not null default false
);
create index if not exists notif_user on public.notifications (user_id, created_at desc);
create unique index if not exists notif_like_uq on public.notifications (user_id, actor, post_id) where type = 'like';
create unique index if not exists notif_follow_uq on public.notifications (user_id, actor) where type = 'follow';
alter table public.notifications enable row level security;
drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "update own notifications" on public.notifications;
create policy "update own notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own notifications" on public.notifications;
create policy "delete own notifications" on public.notifications for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;

create or replace function public.notify_comment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, actor, type, post_id)
  select p.author, new.author, 'comment', new.post_id from public.posts p where p.id = new.post_id and p.author <> new.author;
  return new;
end $$;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments for each row execute function public.notify_comment();

create or replace function public.notify_like() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, actor, type, post_id)
  select p.author, new.user_id, 'like', new.post_id from public.posts p where p.id = new.post_id and p.author <> new.user_id
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists likes_notify on public.likes;
create trigger likes_notify after insert on public.likes for each row execute function public.notify_like();

create or replace function public.notify_follow() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, actor, type) values (new.followee, new.follower, 'follow') on conflict do nothing;
  return new;
end $$;
drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows for each row execute function public.notify_follow();

create or replace view public.notifications_feed with (security_invoker = true) as
  select n.id, n.type, n.post_id, n.created_at, n.read, pr.username as actor_name, pr.accent as actor_accent, p.title as post_title
  from public.notifications n
  join public.profiles pr on pr.id = n.actor
  left join public.posts p on p.id = n.post_id;
grant select on public.notifications_feed to authenticated;

-- 4) 익명 통계 (쿠키·IP·개인식별자 없음. 일별 카운터만 저장)
create table if not exists public.event_counts (
  day date not null default current_date,
  type text not null check (type in ('visit','play','share')),
  key text not null,
  src text not null default '',
  lang text not null default '',
  n bigint not null default 0,
  primary key (day, type, key, src, lang)
);
alter table public.event_counts enable row level security;
drop policy if exists "admin read events" on public.event_counts;
create policy "admin read events" on public.event_counts for select to authenticated using (public.is_admin());
grant select on public.event_counts to authenticated;

create or replace function public.log_event(t text, k text, s text default '', l text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if t not in ('visit','play','share') then return; end if;
  k := left(regexp_replace(coalesce(k, ''), '[^A-Za-z0-9_.-]', '', 'g'), 40);
  s := left(regexp_replace(coalesce(s, ''), '[^A-Za-z0-9_.-]', '', 'g'), 24);
  l := case when l in ('en','ko','ja','id') then l else '' end;
  if k = '' then return; end if;
  if (select count(*) from public.event_counts where day = current_date) > 3000 then return; end if;   -- 남용 방지(하루 행 수 상한)
  insert into public.event_counts as e (day, type, key, src, lang, n) values (current_date, t, k, s, l, 1)
  on conflict (day, type, key, src, lang) do update set n = e.n + 1;
end $$;
revoke all on function public.log_event(text, text, text, text) from public;
grant execute on function public.log_event(text, text, text, text) to anon, authenticated;

-- 5) 디스코드 알림에 붙일 사이트 주소 (비밀 아님)
insert into public.app_settings (key, value) values ('site_url', 'https://kjuhoho.github.io/dropzone-site/community.html')
on conflict (key) do update set value = excluded.value;


-- ===== 007 블록 (프로필 꾸미기/내 음원) =====


-- 1) 프로필 꾸미기 컬럼
alter table public.profiles add column if not exists avatar_path text
  check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
alter table public.profiles add column if not exists banner_path text
  check (banner_path is null or banner_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
alter table public.profiles add column if not exists banner_style smallint
  check (banner_style is null or banner_style between 0 and 7);
alter table public.profiles add column if not exists links jsonb not null default '{}'::jsonb
  check (jsonb_typeof(links) = 'object');
alter table public.profiles drop constraint if exists profiles_bio_check;
alter table public.profiles add constraint profiles_bio_check check (bio is null or char_length(bio) <= 300);

grant update (bio, accent, avatar_path, banner_path, banner_style, links) on public.profiles to authenticated;

-- 본인 폴더의 파일만 지정 가능, 링크는 허용된 키 + https 주소만
create or replace function public.check_profile_fields() returns trigger language plpgsql as $$
declare k text; v jsonb;
begin
  if new.avatar_path is not null and split_part(new.avatar_path, '/', 1) <> new.id::text then raise exception 'bad_path'; end if;
  if new.banner_path is not null and split_part(new.banner_path, '/', 1) <> new.id::text then raise exception 'bad_path'; end if;
  for k, v in select * from jsonb_each(new.links) loop
    if k not in ('instagram','youtube','tiktok','soundcloud','spotify','website')
       or jsonb_typeof(v) <> 'string'
       or (v #>> '{}') !~ '^https://[^[:space:]<>"]{3,200}$' then
      raise exception 'bad_links';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists profiles_check on public.profiles;
create trigger profiles_check before insert or update on public.profiles for each row execute function public.check_profile_fields();

-- 2) 내 음원 (프로필당 최대 5곡)
create table if not exists public.profile_tracks (
  id bigint generated always as identity primary key,
  owner uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  genre text check (genre is null or char_length(genre) <= 30),
  audio_path text not null check (audio_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  cover_path text check (cover_path is null or cover_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check (split_part(audio_path, '/', 1) = owner::text),
  check (cover_path is null or split_part(cover_path, '/', 1) = owner::text)
);
create index if not exists tracks_owner on public.profile_tracks (owner, created_at desc);
create index if not exists tracks_created on public.profile_tracks (created_at desc);
alter table public.profile_tracks enable row level security;

drop policy if exists "read tracks" on public.profile_tracks;
create policy "read tracks" on public.profile_tracks for select using (not hidden or owner = auth.uid() or public.is_admin());
drop policy if exists "add own track" on public.profile_tracks;
create policy "add own track" on public.profile_tracks for insert to authenticated with check (owner = auth.uid() and not public.is_banned());
drop policy if exists "delete own or admin track" on public.profile_tracks;
create policy "delete own or admin track" on public.profile_tracks for delete to authenticated using (owner = auth.uid() or public.is_admin());
drop policy if exists "admin update track" on public.profile_tracks;
create policy "admin update track" on public.profile_tracks for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.profile_tracks to anon, authenticated;
grant insert, delete on public.profile_tracks to authenticated;
grant update (hidden) on public.profile_tracks to authenticated;

create or replace function public.limit_tracks() returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.profile_tracks where owner = new.owner) >= 5 then raise exception 'track_limit'; end if;
  return new;
end $$;
drop trigger if exists tracks_limit on public.profile_tracks;
create trigger tracks_limit before insert on public.profile_tracks for each row execute function public.limit_tracks();

create or replace view public.tracks_feed with (security_invoker = true) as
  select t.id, t.title, t.genre, t.audio_path, t.cover_path, t.created_at, t.owner, pr.username, pr.accent, pr.avatar_path, t.hidden
  from public.profile_tracks t join public.profiles pr on pr.id = t.owner;
grant select on public.tracks_feed to anon, authenticated;

-- 3) 신고 대상에 음원 추가 + 자동 숨김/알림
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('post','comment','track'));

create or replace function public.on_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; who text; txt text; site text;
begin
  select count(*) into n from public.reports where target_type = new.target_type and target_id = new.target_id;
  if n >= 3 then
    if new.target_type = 'post' then update public.posts set hidden = true where id = new.target_id;
    elsif new.target_type = 'comment' then update public.comments set hidden = true where id = new.target_id;
    else update public.profile_tracks set hidden = true where id = new.target_id; end if;
  end if;
  select username into who from public.profiles where id = new.reporter;
  txt := case new.target_type
    when 'post' then (select left(p.title || ' — ' || p.body, 200) from public.posts p where p.id = new.target_id)
    when 'comment' then (select left(c.body, 200) from public.comments c where c.id = new.target_id)
    else (select left(t.title, 200) from public.profile_tracks t where t.id = new.target_id) end;
  select value into site from public.app_settings where key = 'site_url';
  perform public.notify_discord(
    '🚩 New report (' || new.target_type || ' #' || new.target_id || ', ' || n || ' total' || case when n >= 3 then ', auto-hidden' else '' end || ')' || E'\n'
    || 'by @' || coalesce(who, '?') || E'\n> ' || replace(coalesce(txt, '(deleted)'), E'\n', ' ') || E'\n'
    || coalesce(site || '#/admin', ''));
  return new;
end $$;

-- 4) 뷰 갱신 (컬럼은 항상 맨 뒤에 추가)
create or replace view public.posts_feed with (security_invoker = true) as
  select p.id, p.board, p.title, p.body, p.created_at, p.author, pr.username,
         (select count(*) from public.likes l where l.post_id = p.id)    as like_count,
         (select count(*) from public.comments c where c.post_id = p.id) as comment_count,
         p.attachments, p.hidden, pr.accent, pr.avatar_path
  from public.posts p join public.profiles pr on pr.id = p.author;

create or replace view public.comments_feed with (security_invoker = true) as
  select c.id, c.post_id, c.body, c.created_at, c.author, pr.username, c.hidden, pr.accent, pr.avatar_path
  from public.comments c join public.profiles pr on pr.id = c.author;

create or replace view public.profile_stats with (security_invoker = true) as
  select p.id, p.username, p.bio, p.accent, p.created_at,
         (select count(*) from public.posts x where x.author = p.id)       as posts_count,
         (select count(*) from public.follows f where f.followee = p.id)   as followers,
         (select count(*) from public.follows f where f.follower = p.id)   as following,
         p.avatar_path, p.banner_path, p.banner_style, p.links,
         (select count(*) from public.profile_tracks t where t.owner = p.id) as tracks_count
  from public.profiles p;

create or replace view public.reports_feed with (security_invoker = true) as
  select r.id, r.target_type, r.target_id, r.reason, r.created_at, pr.username as reporter_name,
         case r.target_type
           when 'post' then (select left(p.title || ' — ' || p.body, 300) from public.posts p where p.id = r.target_id)
           when 'comment' then (select left(c.body, 300) from public.comments c where c.id = r.target_id)
           else (select left(t.title || coalesce(' · ' || t.genre, ''), 300) from public.profile_tracks t where t.id = r.target_id) end as preview,
         case r.target_type
           when 'post' then (select p.attachments from public.posts p where p.id = r.target_id)
           when 'track' then (select coalesce(jsonb_agg(jsonb_build_object('p', x)), '[]'::jsonb)
                              from public.profile_tracks t, unnest(array_remove(array[t.audio_path, t.cover_path], null)) x where t.id = r.target_id)
           else null end as attachments,
         case r.target_type when 'comment' then (select c.post_id from public.comments c where c.id = r.target_id) else r.target_id end as post_id,
         case r.target_type
           when 'post' then (select p.author from public.posts p where p.id = r.target_id)
           when 'comment' then (select c.author from public.comments c where c.id = r.target_id)
           else (select t.owner from public.profile_tracks t where t.id = r.target_id) end as target_author,
         (select x.username from public.profiles x where x.id = case r.target_type
           when 'post' then (select p.author from public.posts p where p.id = r.target_id)
           when 'comment' then (select c.author from public.comments c where c.id = r.target_id)
           else (select t.owner from public.profile_tracks t where t.id = r.target_id) end) as target_author_name,
         case r.target_type
           when 'post' then (select p.hidden from public.posts p where p.id = r.target_id)
           when 'comment' then (select c.hidden from public.comments c where c.id = r.target_id)
           else (select t.hidden from public.profile_tracks t where t.id = r.target_id) end as target_hidden
  from public.reports r join public.profiles pr on pr.id = r.reporter;
grant select on public.posts_feed, public.comments_feed, public.profile_stats to anon, authenticated;
grant select on public.reports_feed to authenticated;
