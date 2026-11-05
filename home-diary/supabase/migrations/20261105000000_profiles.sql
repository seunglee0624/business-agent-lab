-- M0: 프로필과 가입 트리거
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  nickname text not null unique check (nickname ~ '^[가-힣A-Za-z0-9]{2,12}$'),
  house_name text not null check (char_length(house_name) between 1 and 20),
  points integer not null default 0 check (points >= 0),
  streak integer not null default 0 check (streak >= 0),
  last_record_date date,
  invite_token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now()
);

-- 쓰기 정책이 없으므로 클라이언트는 프로필(포인트 포함)을 직접 바꿀 수 없다.
alter table public.profiles enable row level security;

create policy "본인 프로필 읽기" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

-- 가입 시 프로필 생성. 이메일이 닉네임 해시와 다르면 가입을 막는다(앱의 emailOf와 같은 식).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nick text := new.raw_user_meta_data ->> 'nickname';
begin
  if new.email is distinct from left(encode(extensions.digest(nick, 'sha256'), 'hex'), 32) || '@home.local' then
    raise exception 'email does not match nickname';
  end if;

  insert into public.profiles (id, nickname, house_name)
  values (
    new.id,
    nick,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'house_name'), ''), nick || '의 집')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
