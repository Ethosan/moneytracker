-- Run once in Supabase → SQL Editor.
-- One row per document: meta, ledger, debts, inbox, checks, and one tx-YYYY-MM per month.
create table if not exists public.ledger_docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  body       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.ledger_docs enable row level security;

create policy "Read own docs"   on public.ledger_docs for select using (auth.uid() = user_id);
create policy "Insert own docs" on public.ledger_docs for insert with check (auth.uid() = user_id);
create policy "Update own docs" on public.ledger_docs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own docs" on public.ledger_docs for delete using (auth.uid() = user_id);
