-- 004: 사진·음원 첨부(Storage) + 관리자 기능 (이미 001~003 을 적용한 DB 에 한 번 실행)
-- 관리자 지정은 이 파일에 이메일을 넣지 않고, SQL Editor 에서 별도로 실행한다 (README 참고).

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
