-- 006: 프로필·팔로우, 알림, 익명 방문/재생 통계  (001~005 적용 후 한 번 실행)

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
