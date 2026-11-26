-- 26 Nov 2026 audit fixes (D5, D19, X9). Safe to run again.
-- Apply with:
--   npx supabase db query --linked --project-ref wqpjijgqjhzquncruvlc -f supabase/migrations/20261126000000_audit_hardening.sql
-- supabase/schema.sql carries the same statements, so a fresh project gets them too.

-- 1. The shared AI day count is held at 300, whatever a signed-in account passes in (D5).
--    Before, all_users_day came straight from the caller, so any account could set it to a huge number.
create or replace function public.ai_take_call(per_user_hour int, per_user_day int, all_users_day int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return 'user'; end if;
  per_user_hour := least(coalesce(per_user_hour, 0), 120);
  per_user_day := least(coalesce(per_user_day, 0), 30);
  all_users_day := least(coalesce(all_users_day, 0), 300);
  perform pg_advisory_xact_lock(hashtext('ai_take_call'));
  delete from ai_calls where at < now() - interval '2 days';
  if (select count(*) from ai_calls where at > now() - interval '1 day') >= all_users_day then return 'all'; end if;
  if (select count(*) from ai_calls where user_id = uid and at > now() - interval '1 day') >= per_user_day then return 'user_day'; end if;
  if (select count(*) from ai_calls where user_id = uid and at > now() - interval '1 hour') >= per_user_hour then return 'user'; end if;
  insert into ai_calls (user_id) values (uid);
  return 'ok';
end;
$$;
revoke all on function public.ai_take_call(int, int, int) from public, anon;
grant execute on function public.ai_take_call(int, int, int) to authenticated;

-- 2. Size and row caps on ledger_docs, so one account can't fill the shared database (D19).
--    NOT VALID: new and changed rows must fit, rows already there are not checked. Check first with
--      select max(pg_column_size(body)) from ledger_docs;
--    and, when that is well under 2000000, run:  alter table public.ledger_docs validate constraint ledger_docs_body_size;
alter table public.ledger_docs drop constraint if exists ledger_docs_body_size;
alter table public.ledger_docs add constraint ledger_docs_body_size check (pg_column_size(body) < 2000000) not valid;

-- At most 400 documents per account (the app keeps one per month plus a few: 400 is over 30 years).
create or replace function public.ledger_docs_row_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- an upsert of a document the account already has is a change, not a new row
  if exists (select 1 from public.ledger_docs where user_id = new.user_id and id = new.id) then return new; end if;
  if (select count(*) from public.ledger_docs where user_id = new.user_id) >= 400 then
    raise exception 'Too many documents for one account' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.ledger_docs_row_cap() from public, anon, authenticated;
drop trigger if exists ledger_docs_row_cap on public.ledger_docs;
create trigger ledger_docs_row_cap before insert on public.ledger_docs
  for each row execute function public.ledger_docs_row_cap();

-- 3. Settings -> Delete my account (X9). Removes everything of the caller's, then the sign-in itself.
--    Per-user tables: ledger_docs and ai_calls. (The anonymous feedback table is not tied to an account.)
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from public.ledger_docs where user_id = uid;
  delete from public.ai_calls where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
