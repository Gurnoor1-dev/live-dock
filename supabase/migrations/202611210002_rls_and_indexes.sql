-- Tighten existing policies, reduce permissive policy overlap and index foreign keys.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

drop policy if exists "admins manage memberships" on public.organization_members;
create policy "admins insert memberships" on public.organization_members
for insert to authenticated with check (private.is_org_admin(organization_id));
create policy "admins update memberships" on public.organization_members
for update to authenticated using (private.is_org_admin(organization_id))
with check (private.is_org_admin(organization_id));
create policy "admins delete memberships" on public.organization_members
for delete to authenticated using (private.is_org_admin(organization_id));

drop policy if exists "admins manage aircraft" on public.aircraft;
create policy "admins insert aircraft" on public.aircraft
for insert to authenticated with check (private.is_org_admin(organization_id));
create policy "admins update aircraft" on public.aircraft
for update to authenticated using (private.is_org_admin(organization_id))
with check (private.is_org_admin(organization_id));
create policy "admins delete aircraft" on public.aircraft
for delete to authenticated using (private.is_org_admin(organization_id));

drop policy if exists "admins manage legs" on public.flight_legs;
drop policy if exists "assigned pilots update their legs" on public.flight_legs;
create policy "admins insert legs" on public.flight_legs
for insert to authenticated with check (private.is_org_admin(organization_id));
create policy "admins or assigned pilots update legs" on public.flight_legs
for update to authenticated
using (
  private.is_org_admin(organization_id)
  or (private.is_org_member(organization_id) and (pilot_id = (select auth.uid()) or copilot_id = (select auth.uid())))
)
with check (
  private.is_org_member(organization_id)
  and (private.is_org_admin(organization_id) or pilot_id = (select auth.uid()) or copilot_id = (select auth.uid()))
);
create policy "admins delete legs" on public.flight_legs
for delete to authenticated using (private.is_org_admin(organization_id));

create index if not exists admin_activity_actor_idx on public.admin_activity(actor_id);
create index if not exists admin_activity_org_idx on public.admin_activity(organization_id);
create index if not exists aircraft_created_by_idx on public.aircraft(created_by);
create index if not exists crew_requests_reviewed_by_idx on public.crew_requests(reviewed_by);
create index if not exists flight_legs_aircraft_idx on public.flight_legs(aircraft_id);
create index if not exists flight_legs_copilot_idx on public.flight_legs(copilot_id);
create index if not exists flight_legs_created_by_idx on public.flight_legs(created_by);
create index if not exists organization_members_user_idx on public.organization_members(user_id);
create index if not exists organizations_created_by_idx on public.organizations(created_by);
