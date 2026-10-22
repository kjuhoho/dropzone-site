-- 007: 프로필 꾸미기(아바타·배너·링크·소개) + 내 음원(profile_tracks) + 신고 대상에 음원 추가
-- (001~006 적용 후 한 번 실행)

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
