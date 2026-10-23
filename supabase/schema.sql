-- Run in Supabase → SQL Editor. Safe to re-run: existing policies are replaced, not duplicated.
-- One row per document: meta, ledger, debts, inbox, checks, and one tx-YYYY-MM per month.
create table if not exists public.ledger_docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  body       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.ledger_docs enable row level security;

drop policy if exists "Read own docs" on public.ledger_docs;
create policy "Read own docs"   on public.ledger_docs for select using (auth.uid() = user_id);
drop policy if exists "Insert own docs" on public.ledger_docs;
create policy "Insert own docs" on public.ledger_docs for insert with check (auth.uid() = user_id);
drop policy if exists "Update own docs" on public.ledger_docs;
create policy "Update own docs" on public.ledger_docs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Delete own docs" on public.ledger_docs;
create policy "Delete own docs" on public.ledger_docs for delete using (auth.uid() = user_id);

-- Usage caps for the ledger-ai Edge Function: one row per AI call, written only through
-- ai_take_call(), which the function calls before every request. Safe to run again.
create table if not exists public.ai_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists ai_calls_at on public.ai_calls (at);
create index if not exists ai_calls_user_at on public.ai_calls (user_id, at);
alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from anon, authenticated;

-- Returns 'ok' (call recorded), 'user' (this account hit its hourly cap) or 'all' (every
-- account together hit the daily cap).
create or replace function public.ai_take_call(per_user_hour int, all_users_day int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return 'user'; end if;
  perform pg_advisory_xact_lock(hashtext('ai_take_call'));
  delete from ai_calls where at < now() - interval '2 days';
  if (select count(*) from ai_calls where at > now() - interval '1 day') >= all_users_day then return 'all'; end if;
  if (select count(*) from ai_calls where user_id = uid and at > now() - interval '1 hour') >= per_user_hour then return 'user'; end if;
  insert into ai_calls (user_id) values (uid);
  return 'ok';
end;
$$;
revoke all on function public.ai_take_call(int, int) from public, anon;
grant execute on function public.ai_take_call(int, int) to authenticated;
