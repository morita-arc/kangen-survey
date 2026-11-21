-- かんげんアンケート: 全データ共有用スキーマ（Supabase SQL Editorで実行）
-- 1つの行ストアに customers / submissions / products / stock_moves / reservation_links を保存します。

create table if not exists public.app_rows (
  table_name text not null,
  row_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  device_id text,
  primary key (table_name, row_id)
);

create index if not exists app_rows_updated_at_idx on public.app_rows (updated_at);

create or replace function public.touch_app_rows_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_rows_touch_updated_at on public.app_rows;
create trigger app_rows_touch_updated_at
before insert or update on public.app_rows
for each row execute function public.touch_app_rows_updated_at();

alter table public.app_rows enable row level security;

drop policy if exists "app_rows_authenticated_all" on public.app_rows;
create policy "app_rows_authenticated_all"
on public.app_rows
for all
to authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.app_rows to authenticated;
revoke all on public.app_rows from anon;

-- リアルタイム同期
do $$
begin
  alter publication supabase_realtime add table public.app_rows;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
