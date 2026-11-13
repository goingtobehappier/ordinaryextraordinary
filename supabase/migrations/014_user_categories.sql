-- 사용자별 1차 태그(6개) 이름 설정.
--   · 항상 정확히 6개. 1~5번 슬롯만 이름 변경 가능, 6번은 '업무'로 영구 고정.
--   · rename_category(slot, name): 설정 변경 + 기존 할 일(todos.category)을 새 이름으로 한 트랜잭션에서 일괄 변경.
--   · 이름을 바꿀 수 있으므로 todos.category의 고정 허용 목록 제약(todos_category_check)을 제거합니다.
-- Supabase SQL Editor에서 통째로 실행하세요. 여러 번 실행해도 안전합니다.

begin;

create table if not exists public.user_categories (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  labels     text[] not null default array['일정', '미팅', '보고', '마감', '회의', '업무'],
  updated_at timestamptz not null default now(),
  constraint user_categories_labels_check
    check (array_length(labels, 1) = 6 and array_position(labels, null) is null and labels[6] = '업무')
);

drop trigger if exists user_categories_touch on public.user_categories;
create trigger user_categories_touch before update on public.user_categories
  for each row execute function public.touch_updated_at();

alter table public.user_categories enable row level security;
revoke all on public.user_categories from anon;
grant select, insert, update on public.user_categories to authenticated;

drop policy if exists "user_categories: owner only" on public.user_categories;
create policy "user_categories: owner only" on public.user_categories
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 1차 태그 이름이 사용자별로 달라지므로 고정 목록 제약 → 길이 제약으로 교체
alter table public.todos drop constraint if exists todos_category_check;
do $$ begin
  alter table public.todos add constraint todos_category_len
    check (char_length(btrim(category)) between 1 and 10);
exception when duplicate_object then null; end $$;

-- 이름 변경 (p_slot: 1~5). 성공 시 변경된 6개 이름을 반환
create or replace function public.rename_category(p_slot int, p_name text)
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := btrim(coalesce(p_name, ''));
  v_labels text[];
  v_old    text;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if p_slot is null or p_slot < 1 or p_slot > 5 then
    raise exception '6번 ''업무'' 태그는 수정할 수 없습니다.' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception '태그 이름을 입력해 주세요.' using errcode = '22023';
  end if;
  if char_length(v_name) > 10 then
    raise exception '태그 이름은 10자 이하로 입력해 주세요.' using errcode = '22023';
  end if;
  if v_name ~ '[,()*%\\"{}#]' then
    raise exception '태그 이름에 사용할 수 없는 문자가 있습니다.' using errcode = '22023';
  end if;

  insert into public.user_categories (user_id) values (v_uid) on conflict (user_id) do nothing;
  select labels into v_labels from public.user_categories where user_id = v_uid for update;

  v_old := v_labels[p_slot];
  if v_old = v_name then
    return v_labels;
  end if;
  if v_name = any (v_labels) then
    raise exception '이미 사용 중인 태그 이름입니다.' using errcode = '23505';
  end if;

  v_labels[p_slot] := v_name;
  update public.user_categories set labels = v_labels where user_id = v_uid;
  update public.todos set category = v_name where user_id = v_uid and category = v_old;
  return v_labels;
end $$;

revoke all on function public.rename_category(int, text) from public, anon;
grant execute on function public.rename_category(int, text) to authenticated;

-- Realtime 등록 (다른 기기에서 바꾼 태그 이름 반영)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_categories'
  ) then
    alter publication supabase_realtime add table public.user_categories;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
