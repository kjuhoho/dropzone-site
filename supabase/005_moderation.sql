-- 005: 운영 도구 — 신고 알림(디스코드), 신고 누적 자동 숨김, 계정 정지, 신규 계정 제한
-- 이미 001~004 를 적용한 DB 에 한 번 실행. 디스코드 웹훅 URL 은 비밀값이므로 이 파일에 넣지 않고 README 대로 SQL Editor 에서 직접 넣는다.

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
