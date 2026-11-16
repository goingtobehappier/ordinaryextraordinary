-- due_date만 넣고 date를 비운 행(SQL Editor·외부 스크립트로 직접 넣은 일정)이
-- 캘린더에 보이지 않던 문제 수정.
--
-- 원인: 앱은 `date` 컬럼으로만 조회한다. date를 비우고 넣으면 기본값(current_date, 입력한 날)이
-- 들어가고, 001의 트리거가 due_date := date 로 덮어써서 입력한 미래 날짜가 사라졌다.
-- 수정: 입력 시 due_date가 있으면 date로 쓰고, 수정 시 due_date만 바뀌었으면 date도 따라가게 한다.
-- 여러 번 실행해도 안전합니다.

begin;

create or replace function public.todos_sync_legacy()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- 앱은 due_date를 보내지 않음(null) → 외부에서 due_date만 넣은 경우에만 적용
    if new.due_date is not null then
      new.date := new.due_date::date;
    end if;
  elsif new.due_date is distinct from old.due_date and new.date is not distinct from old.date then
    -- due_date만 고친 경우
    if new.due_date is not null then
      new.date := new.due_date::date;
    end if;
  end if;

  new.due_date     := new.date;
  new.is_completed := coalesce(new.date = any(new.completed_dates), false);
  new.updated_at   := now();
  return new;
end $$;

-- 이미 어긋난 행 정리: due_date와 date가 다르면 due_date 기준으로 맞춤
update public.todos
   set date = due_date::date
 where due_date is not null
   and date is distinct from due_date::date;

commit;

notify pgrst, 'reload schema';
