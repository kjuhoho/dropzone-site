-- 사이트 현황 보고용(읽기 전용 집계). 관리자 로그인 없이 비밀 키로만 호출된다. 키 자체는 저장하지 않고 sha256 해시만 app_settings 에 둔다.
-- 해시 등록(키는 로컬 파일에만 있고 여기에 적지 않는다):
--   insert into public.app_settings (key, value) values ('report_key_hash', '<sha256 hex>')
--   on conflict (key) do update set value = excluded.value;
create or replace function public.site_report(k text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  select value into h from public.app_settings where key = 'report_key_hash';
  if h is null or encode(sha256(convert_to(coalesce(k, ''), 'UTF8')), 'hex') <> h then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from (
        select day, type, key, src, lang, n from public.event_counts where day >= current_date - 60 order by day) e), '[]'::jsonb),
    'members', jsonb_build_object(
        'total', (select count(*) from public.profiles),
        'last7', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
        'last30', (select count(*) from public.profiles where created_at >= now() - interval '30 days')),
    'signups_by_day', coalesce((select jsonb_agg(to_jsonb(s)) from (
        select created_at::date as day, count(*) as n from public.profiles
        where created_at >= now() - interval '30 days' group by 1 order by 1) s), '[]'::jsonb),
    'posts', jsonb_build_object(
        'total', (select count(*) from public.posts),
        'last7', (select count(*) from public.posts where created_at >= now() - interval '7 days'),
        'last30', (select count(*) from public.posts where created_at >= now() - interval '30 days'),
        'hidden', (select count(*) from public.posts where hidden)),
    'comments', jsonb_build_object(
        'total', (select count(*) from public.comments),
        'last7', (select count(*) from public.comments where created_at >= now() - interval '7 days')),
    'user_tracks', (select count(*) from public.profile_tracks),
    'reports_open', (select count(*) from public.reports),
    'bans_active', (select count(*) from public.bans where until is null or until > now()),
    'posts_by_board', coalesce((select jsonb_agg(to_jsonb(b)) from (
        select board, count(*) as n from public.posts where created_at >= now() - interval '30 days' group by 1 order by 2 desc) b), '[]'::jsonb),
    'top_posts', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select id, board, title, username, like_count, comment_count from public.posts_feed
        where created_at >= now() - interval '30 days' order by like_count desc, comment_count desc limit 5) t), '[]'::jsonb)
  );
end $$;
revoke all on function public.site_report(text) from public;
grant execute on function public.site_report(text) to anon, authenticated;
