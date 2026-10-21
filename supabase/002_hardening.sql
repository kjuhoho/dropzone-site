-- 002: 구글 로그인 대비 + 계정 삭제 + 서버측 스팸 제한  (이미 schema.sql 을 적용한 DB 에 한 번 실행)
-- 신규 설치는 schema.sql 만 실행하면 되고, 이 파일 내용은 그쪽에도 반영되어 있다.

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
