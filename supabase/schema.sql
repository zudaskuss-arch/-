-- Supabase SQL Editor에 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.
create table if not exists vocab_kv (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table vocab_kv enable row level security;

drop policy if exists "select own" on vocab_kv;
create policy "select own" on vocab_kv
  for select using (auth.uid() = user_id);

drop policy if exists "insert own" on vocab_kv;
create policy "insert own" on vocab_kv
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own" on vocab_kv;
create policy "update own" on vocab_kv
  for update using (auth.uid() = user_id);
