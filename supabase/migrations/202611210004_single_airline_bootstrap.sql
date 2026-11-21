-- Virtual Blue is a single-airline workspace: only the first organization may be bootstrapped.
create or replace function private.is_first_organization()
returns boolean language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.organizations);
$$;
grant execute on function private.is_first_organization() to authenticated;

drop policy if exists "signed-in users can create an organization" on public.organizations;
create policy "bootstrap the first Virtual Blue organization" on public.organizations
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.is_first_organization()
);
