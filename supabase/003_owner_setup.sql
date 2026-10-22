-- ---------------------------------------------------------------------------
-- 003 — First-run owner setup
--
-- Run this in the Supabase SQL editor after schema.sql and 002_core_additions.sql.
-- It lets the first signed-in account claim owner access from the sign-in page.
-- Once any owner exists, the function refuses every later claim.
-- ---------------------------------------------------------------------------

create or replace function public.claim_owner()
returns public.app_role
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  existing integer;
begin
  if uid is null then
    raise exception 'Sign in before claiming owner access.';
  end if;

  -- Serialise simultaneous first-run claims. The local setting lets the role
  -- guard distinguish this checked bootstrap from a direct client self-update.
  perform pg_advisory_xact_lock(707001);
  perform set_config('csf.owner_bootstrap', uid::text, true);

  select count(*) into existing from public.profiles where role = 'owner';
  if existing > 0 then
    raise exception 'An owner account already exists. Ask the owner to promote you.';
  end if;

  update public.profiles
     set role = 'owner', active = true, updated_at = now()
   where id = uid and active;

  if not found then
    raise exception 'No active profile found for this account.';
  end if;

  return 'owner'::public.app_role;
end $$;

revoke execute on function public.claim_owner() from public, anon;
grant execute on function public.claim_owner() to authenticated;

-- Keep the existing role guard, but allow the checked bootstrap above.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bootstrap_uid text := current_setting('csf.owner_bootstrap', true);
begin
  if auth.uid() is not null and not public.is_owner() then
    if new.role is distinct from old.role then
      if not (
        new.role = 'owner'
        and new.id = auth.uid()
        and coalesce(bootstrap_uid = auth.uid()::text, false)
      ) then
        raise exception 'Only an owner can change a role';
      end if;
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an owner can activate or deactivate a user';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_role on public.profiles;
create trigger trg_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();
