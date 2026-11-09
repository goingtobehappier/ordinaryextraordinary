-- 현재 DB에 빠져 있는 컬럼만 보완합니다 (001이 일부만 적용된 상태 대응).
--   todo_details.subtasks  : 하위 작업 저장 (없으면 하위 작업 저장 실패)
--   daily_notes.date       : 데일리 노트 저장/조회 (없으면 스크래치패드 저장 실패)
--   todos.updated_at       : 수정 시각
-- 기존 컬럼(sub_tasks, note_date)과 데이터는 유지하며 값을 옮겨 옵니다. 여러 번 실행해도 안전합니다.

begin;

-- ── todo_details.subtasks ──
alter table public.todo_details add column if not exists subtasks jsonb not null default '[]'::jsonb;

do $$ begin
  update public.todo_details d
     set subtasks = coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id',   coalesce(e->>'id', gen_random_uuid()::text),
                    'text', coalesce(e->>'text', e->>'title', e->>'name', e #>> '{}'),
                    'done', coalesce((e->>'done')::boolean, (e->>'completed')::boolean, false)))
             from jsonb_array_elements(to_jsonb(d.sub_tasks)) e), '[]'::jsonb)
   where d.subtasks = '[]'::jsonb
     and d.sub_tasks is not null
     and jsonb_typeof(to_jsonb(d.sub_tasks)) = 'array';
exception when others then
  raise notice 'sub_tasks 이전 생략: %', sqlerrm;
end $$;

-- 앱은 todo 하나당 상세 1행(upsert on todo_id) → 중복 정리 후 unique
delete from public.todo_details a
 using public.todo_details b
 where a.todo_id = b.todo_id and a.ctid < b.ctid;
create unique index if not exists todo_details_todo_id_key on public.todo_details (todo_id);
alter table public.todo_details alter column user_id set default auth.uid();

-- ── daily_notes.date ──
alter table public.daily_notes add column if not exists date date;
update public.daily_notes set date = note_date::date where date is null;
alter table public.daily_notes alter column date set not null;
alter table public.daily_notes alter column note_date drop not null;
alter table public.daily_notes alter column user_id set default auth.uid();

-- 레거시 note_date도 계속 맞춰 둠
create or replace function public.daily_notes_sync_legacy()
returns trigger language plpgsql as $$
begin
  new.note_date  := new.date;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists daily_notes_sync_legacy on public.daily_notes;
create trigger daily_notes_sync_legacy before insert or update on public.daily_notes
  for each row execute function public.daily_notes_sync_legacy();

-- 같은 날짜 노트가 여러 개면 최신 것만 남기고 unique (upsert on user_id,date)
delete from public.daily_notes a
 using public.daily_notes b
 where a.user_id = b.user_id and a.date = b.date
   and (a.updated_at, a.ctid) < (b.updated_at, b.ctid);
create unique index if not exists daily_notes_user_date_key on public.daily_notes (user_id, date);

-- ── todos.updated_at ──
alter table public.todos add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists todos_touch on public.todos;
create trigger todos_touch before update on public.todos
  for each row execute function public.touch_updated_at();

commit;

notify pgrst, 'reload schema';
