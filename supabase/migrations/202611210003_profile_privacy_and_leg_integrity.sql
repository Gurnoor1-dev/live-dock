-- Restrict pilot profile visibility to the same airline and enforce tenant consistency.
drop policy if exists "profiles visible to signed-in users" on public.profiles;
create policy "profiles visible to self and organization peers" on public.profiles
for select to authenticated using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.organization_members mine
    join public.organization_members peer
      on peer.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and peer.user_id = profiles.id
      and peer.status = 'active'
  )
);

create or replace function private.validate_leg_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  aircraft_org uuid;
begin
  if new.aircraft_id is not null then
    select a.organization_id into aircraft_org
    from public.aircraft a where a.id = new.aircraft_id;
    if aircraft_org is null or aircraft_org <> new.organization_id then
      raise exception 'Assigned aircraft must belong to the same organization as the flight leg';
    end if;
  end if;

  if new.pilot_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.pilot_id and m.status = 'active'
  ) then
    raise exception 'Assigned captain must be an active member of the organization';
  end if;

  if new.copilot_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.copilot_id and m.status = 'active'
  ) then
    raise exception 'Assigned first officer must be an active member of the organization';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_leg_integrity on public.flight_legs;
create trigger validate_leg_integrity
before insert or update of organization_id, aircraft_id, pilot_id, copilot_id
on public.flight_legs
for each row execute function private.validate_leg_integrity();
