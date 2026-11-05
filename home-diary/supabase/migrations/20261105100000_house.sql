-- M1: 방, 카탈로그, 보유 가구, 배치

create table public.houses (
  profile_id uuid primary key references public.profiles on delete cascade,
  size integer not null default 4 check (size between 4 and 8),
  wallpaper text,
  floor text
);

create table public.catalog (
  id text primary key,
  kind text not null check (kind in ('closet', 'table', 'desk', 'tv', 'plant', 'bed', 'bookcase', 'piano')),
  style text not null check (style in ('wood', 'modern', 'vintage')),
  price integer not null check (price >= 0),
  unique (kind, style),
  unique (id, kind)
);

-- 우드 가격표. 모던·빈티지는 우드 + 50P, 무료 종류는 100P. 숫자는 M4에서 조정한다.
insert into public.catalog (id, kind, style, price)
select kind || '-' || style, kind, style,
  case when style = 'wood' then wood when wood = 0 then 100 else wood + 50 end
from (values ('closet', 0), ('table', 0), ('desk', 0), ('tv', 0),
             ('plant', 50), ('bed', 80), ('bookcase', 120), ('piano', 300)) as k(kind, wood)
cross join (values ('wood'), ('modern'), ('vintage')) as s(style);

create table public.owned_furniture (
  profile_id uuid not null references public.profiles on delete cascade,
  catalog_id text not null references public.catalog,
  primary key (profile_id, catalog_id)
);

-- 종류당 하나만 놓이고, 한 칸에는 가구 하나. 놓인 가구는 반드시 보유한 것이다.
create table public.placements (
  profile_id uuid not null references public.profiles on delete cascade,
  kind text not null,
  catalog_id text not null,
  x integer not null check (x >= 0),
  y integer not null check (y >= 0),
  primary key (profile_id, kind),
  unique (profile_id, x, y),
  foreign key (catalog_id, kind) references public.catalog (id, kind),
  foreign key (profile_id, catalog_id) references public.owned_furniture (profile_id, catalog_id)
);

-- 읽기만 열고, 쓰기는 아래 함수로만 한다.
alter table public.houses enable row level security;
alter table public.catalog enable row level security;
alter table public.owned_furniture enable row level security;
alter table public.placements enable row level security;

create policy "카탈로그 읽기" on public.catalog for select to authenticated using (true);
create policy "본인 방 읽기" on public.houses for select to authenticated using ((select auth.uid()) = profile_id);
create policy "본인 보유 가구 읽기" on public.owned_furniture for select to authenticated using ((select auth.uid()) = profile_id);
create policy "본인 배치 읽기" on public.placements for select to authenticated using ((select auth.uid()) = profile_id);

-- 새 집: 4×4 방에 우드 기본 가구 4종을 지급하고 놓는다.
create function public.furnish_new_house(p_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.houses (profile_id) values (p_profile_id);
  insert into public.owned_furniture (profile_id, catalog_id)
  values (p_profile_id, 'closet-wood'), (p_profile_id, 'table-wood'), (p_profile_id, 'desk-wood'), (p_profile_id, 'tv-wood');
  insert into public.placements (profile_id, kind, catalog_id, x, y)
  values (p_profile_id, 'closet', 'closet-wood', 0, 0), (p_profile_id, 'desk', 'desk-wood', 2, 0),
         (p_profile_id, 'tv', 'tv-wood', 0, 2), (p_profile_id, 'table', 'table-wood', 2, 2);
$$;

revoke execute on function public.furnish_new_house(uuid) from public, anon, authenticated;

create function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.furnish_new_house(new.id);
  return new;
end;
$$;

create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- M0 때 가입한 사람들에게도 집을 채워 준다.
select public.furnish_new_house(p.id)
from public.profiles p
where not exists (select 1 from public.houses h where h.profile_id = p.id);

-- 보유한 가구를 내 방의 빈 칸에 놓는다. 같은 종류가 이미 놓여 있으면 그 자리를 옮기거나 스타일을 바꾼다.
create function public.place_furniture(p_catalog_id text, p_x integer, p_y integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_kind text;
  v_size integer;
begin
  select c.kind into v_kind
  from public.catalog c
  join public.owned_furniture o on o.catalog_id = c.id and o.profile_id = uid
  where c.id = p_catalog_id;
  if v_kind is null then
    raise exception 'not_owned';
  end if;

  select size into v_size from public.houses where profile_id = uid;
  if p_x < 0 or p_y < 0 or p_x >= v_size or p_y >= v_size then
    raise exception 'outside_room';
  end if;

  if exists (select 1 from public.placements
             where profile_id = uid and x = p_x and y = p_y and kind <> v_kind) then
    raise exception 'tile_taken';
  end if;

  insert into public.placements (profile_id, kind, catalog_id, x, y)
  values (uid, v_kind, p_catalog_id, p_x, p_y)
  on conflict (profile_id, kind) do update
    set catalog_id = excluded.catalog_id, x = excluded.x, y = excluded.y;
end;
$$;

revoke execute on function public.place_furniture(text, integer, integer) from public, anon;
grant execute on function public.place_furniture(text, integer, integer) to authenticated;
