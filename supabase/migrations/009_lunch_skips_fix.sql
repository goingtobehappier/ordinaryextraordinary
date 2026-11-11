-- lunch_skips 'null value in column "skip_date" violates not-null constraint' 해결.
--   원인: 기존에 skip_date 컬럼으로 만든 lunch_skips 테이블이 있어서 008의 create table if not exists가
--         건너뛰어졌고, 앱은 date 컬럼만 보내 skip_date가 비어 있었음.
--   조치: date·skip_date 두 컬럼을 모두 두고 값을 서로 채우며(트리거), 둘 중 하나만 와도 저장되게 함.
-- Supabase SQL Editor에서 통째로 실행하세요. 여러 번 실행해도 안전합니다.

begin;

alter table public.lunch_skips add column if not exists date      date;
alter table public.lunch_skips add column if not exists skip_date date;
alter table public.lunch_skips add column if not exists user_id   uuid references auth.users (id) on delete cascade;
alter table public.lunch_skips add column if not exists created_at timestamptz not null default now();

-- 기존 행 값 맞추기
-- skip_date가 text 등 다른 타입이어도 동작하도록 명시적 변환
update public.lunch_skips set date      = skip_date::date where date is null and skip_date is not null;
update public.lunch_skips set skip_date = date      where skip_date is null and date is not null;
delete from public.lunch_skips where date is null;

-- 둘 중 하나만 와도 나머지를 채우고, 둘 다 없으면 명확한 오류
create or replace function public.lunch_skips_sync_dates()
returns trigger language plpgsql as $$
begin
  -- 타입이 달라도 되도록 coalesce 대신 개별 대입 (plpgsql 대입은 자동 변환)
  if new.date is null and new.skip_date is not null then
    new.date := new.skip_date::date;
  end if;
  if new.skip_date is null then
    new.skip_date := new.date;
  end if;
  if new.date is null then
    raise exception 'lunch_skips: date(skip_date) 값이 필요합니다' using errcode = '23502';
  end if;
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists lunch_skips_sync_dates on public.lunch_skips;
create trigger lunch_skips_sync_dates before insert or update on public.lunch_skips
  for each row execute function public.lunch_skips_sync_dates();

alter table public.lunch_skips alter column user_id set default auth.uid();
alter table public.lunch_skips alter column date      set not null;
alter table public.lunch_skips alter column skip_date set not null;

-- 같은 날짜 중복 정리 후 unique (앱은 중복 insert를 성공으로 처리)
delete from public.lunch_skips a
 using public.lunch_skips b
 where a.user_id is not distinct from b.user_id and a.date = b.date and a.ctid < b.ctid;
create unique index if not exists lunch_skips_user_date_key on public.lunch_skips (user_id, date);

-- RLS
alter table public.lunch_skips enable row level security;
revoke all on public.lunch_skips from anon;
grant select, insert, update, delete on public.lunch_skips to authenticated;

drop policy if exists "lunch_skips: owner only" on public.lunch_skips;
create policy "lunch_skips: owner only" on public.lunch_skips
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;

notify pgrst, 'reload schema';

-- 확인용: date·skip_date 모두 is_nullable = NO 여야 합니다.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'lunch_skips'
 order by ordinal_position;
