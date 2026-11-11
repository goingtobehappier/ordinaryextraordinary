-- 당일 점심시간 삭제(스킵) 기록.
--   기본 점심시간 설정은 그대로 두고, 여기 기록된 날짜에만 타임블록에서 점심시간을 숨깁니다.
--   행이 있으면 스킵, 삭제하면 복원. Supabase SQL Editor에서 실행하세요. 여러 번 실행해도 안전합니다.

begin;

create table if not exists public.lunch_skips (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

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
