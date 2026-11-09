-- 태그 필수화: 비어 있는 태그는 '기타업무'로 채우고, 이후 빈 태그 저장을 DB에서 차단합니다.
-- 001_align_legacy_schema.sql 실행 후 SQL Editor에서 실행하세요. 여러 번 실행해도 안전합니다.

begin;

update public.todos
   set tags = array['기타업무']
 where tags is null or cardinality(array_remove(tags, '')) = 0;

alter table public.todos alter column tags set default array['기타업무'];
alter table public.todos alter column tags set not null;

do $$ begin
  alter table public.todos add constraint todos_tags_required
    check (cardinality(tags) > 0 and not ('' = any(tags)));
exception when duplicate_object then null; end $$;

commit;

notify pgrst, 'reload schema';
