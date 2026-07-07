alter table public.playmaker_signals
  add column if not exists price numeric,
  add column if not exists entry_price numeric,
  add column if not exists trigger_price numeric,
  add column if not exists raw_json jsonb,
  add column if not exists payload jsonb;
