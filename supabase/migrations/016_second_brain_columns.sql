begin;

alter table public.todos
  add column if not exists ai_tags text[] not null default '{}'::text[],
  add column if not exists used_tools text[] not null default '{}'::text[],
  add column if not exists retrospective_memo text;

create index if not exists idx_todos_user_date
  on public.todos (user_id, date desc);

create index if not exists idx_todos_ai_tags
  on public.todos using gin (ai_tags);

create index if not exists idx_todos_used_tools
  on public.todos using gin (used_tools);

commit;

notify pgrst, 'reload schema';
