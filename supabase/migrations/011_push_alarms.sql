-- 타임테이블 백그라운드 알림 (탭을 닫아도 OS 알림): Web Push + Supabase Cron (무료 플랜 범위)
--
--   1) push_subscriptions : 기기(브라우저)별 푸시 구독. 앱의 알림 토글로 등록/해제
--   2) push_alarm_log      : 이미 보낸 알림 기록 (중복 발송 방지, 3일 지나면 자동 삭제)
--   3) 매분 Cron → Edge Function `send-alarms` 호출 → 시작 5분 전 · 정각 알림 발송
--
-- Supabase SQL Editor에서 통째로 실행하세요. 여러 번 실행해도 안전합니다.
-- Cron이 실제로 동작하려면 Vault 시크릿 2개가 필요합니다 (없으면 아무것도 하지 않음):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<임의의 긴 문자열>', 'alarm_cron_secret');   -- Edge Function의 ALARM_CRON_SECRET과 같은 값

begin;

-- ───────────── 구독 ─────────────
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  -- 기기의 시간대 (IANA, 예: Asia/Seoul) — 이 기준으로 '정각'을 판단
  tz          text not null default 'Asia/Seoul',
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
grant select, delete on public.push_subscriptions to authenticated;

drop policy if exists "push_subscriptions: owner only" on public.push_subscriptions;
create policy "push_subscriptions: owner only" on public.push_subscriptions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 같은 브라우저에서 다른 계정으로 로그인한 경우에도 endpoint 소유자를 현재 사용자로 옮겨 등록
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_tz text, p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.push_subscriptions as s (endpoint, user_id, p256dh, auth, tz, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, coalesce(nullif(p_tz, ''), 'Asia/Seoul'), p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        tz = excluded.tz, user_agent = excluded.user_agent, updated_at = now();
end $$;

create or replace function public.unregister_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- ───────────── 발송 기록 (Edge Function이 service role로만 사용) ─────────────
create table if not exists public.push_alarm_log (
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- `${todoId}|${YYYY-MM-DD}|${HH:MM}|pre|start`
  alarm_key  text not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, alarm_key)
);
alter table public.push_alarm_log enable row level security;
revoke all on public.push_alarm_log from anon, authenticated;

commit;

-- ───────────── 매분 Cron ─────────────
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Vault 시크릿이 있을 때만 Edge Function 호출
create or replace function public.trigger_send_alarms() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'alarm_cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-alarms',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;
revoke all on function public.trigger_send_alarms() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'send-alarms';
select cron.schedule('send-alarms', '* * * * *', $$ select public.trigger_send_alarms() $$);

notify pgrst, 'reload schema';
