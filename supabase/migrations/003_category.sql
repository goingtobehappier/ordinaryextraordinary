-- 2단계 태그: 1차 태그(category, 필수) 컬럼 추가. 기존 tags 컬럼은 2차 태그로 그대로 사용합니다.
-- 001, 002 실행 후 SQL Editor에서 실행하세요. 여러 번 실행해도 안전합니다.

begin;

alter table public.todos add column if not exists category text not null default '업무';

-- 이미 category 컬럼이 있던 경우: 허용 목록 밖의 값·null은 '업무'로 정리 후 기본값/필수 지정
update public.todos
   set category = '업무'
 where category is null
    or category not in ('일정', '미팅', '보고', '마감', '회의', '업무');
alter table public.todos alter column category set default '업무';
alter table public.todos alter column category set not null;

-- 기존 2차 태그에 1차 태그 이름이 들어 있으면 1차 태그로 승격
update public.todos t
   set category = c.name
  from (values ('마감', 1), ('보고', 2), ('미팅', 3), ('회의', 4), ('일정', 5)) as c(name, prio)
 where t.category = '업무'
   and c.name = any(t.tags)
   and c.prio = (select min(c2.prio)
                   from (values ('마감', 1), ('보고', 2), ('미팅', 3), ('회의', 4), ('일정', 5)) as c2(name, prio)
                  where c2.name = any(t.tags));

do $$ begin
  alter table public.todos add constraint todos_category_check
    check (category in ('일정', '미팅', '보고', '마감', '회의', '업무'));
exception when duplicate_object then null; end $$;

create index if not exists todos_user_category_idx on public.todos (user_id, category);

commit;

notify pgrst, 'reload schema';
