-- Virtual Blue Fleet Operations — initial schema
create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create type public.member_role as enum ('owner','admin','pilot');
create type public.member_status as enum ('invited','active','suspended');
create type public.aircraft_status as enum ('available','in_flight','maintenance','reserved','stored');
create type public.leg_status as enum ('scheduled','boarding','taxiing','airborne','landed','cancelled','diverted');
create type public.request_status as enum ('pending','approved','rejected','withdrawn');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  if_user_id text unique,
  if_username text,
  callsign text,
  avatar_url text,
  simbrief_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Virtual Blue',
  slug text not null unique default 'virtual-blue',
  description text,
  timezone text not null default 'UTC',
  if_organization_id text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'pilot',
  status public.member_status not null default 'active',
  joined_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table public.aircraft (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  registration text not null,
  aircraft_type text not null,
  manufacturer text,
  status public.aircraft_status not null default 'available',
  current_airport text,
  home_airport text,
  image_url text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,registration)
);

create table public.flight_legs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aircraft_id uuid references public.aircraft(id) on delete set null,
  flight_number text,
  departure_airport text not null,
  arrival_airport text not null,
  scheduled_departure timestamptz not null,
  scheduled_arrival timestamptz,
  status public.leg_status not null default 'scheduled',
  pilot_id uuid references public.profiles(id) on delete set null,
  copilot_id uuid references public.profiles(id) on delete set null,
  simbrief_ofp_id text,
  dispatch_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (departure_airport <> arrival_airport)
);

create table public.crew_requests (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.flight_legs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_seat text not null default 'first_officer' check (requested_seat in ('captain','first_officer')),
  status public.request_status not null default 'pending',
  message text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (leg_id,user_id)
);

create table public.flight_logs (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references public.flight_legs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat text,
  block_off timestamptz,
  block_on timestamptz,
  duration_minutes integer generated always as (
    case when block_off is not null and block_on is not null
      then greatest(0, floor(extract(epoch from (block_on - block_off))/60)::integer)
      else null end
  ) stored,
  created_at timestamptz not null default now(),
  unique (leg_id,user_id)
);

create table public.admin_activity (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index aircraft_org_status_idx on public.aircraft(organization_id,status);
create index legs_org_departure_idx on public.flight_legs(organization_id,scheduled_departure);
create index legs_pilot_idx on public.flight_legs(pilot_id,scheduled_departure);
create index crew_requests_user_status_idx on public.crew_requests(user_id,status);
create index flight_logs_user_idx on public.flight_logs(user_id,created_at desc);

-- These private helpers are SECURITY DEFINER only because membership rows are
-- themselves protected by RLS. Each helper checks auth.uid() explicitly.
create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.is_org_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('owner','admin')
  );
$$;

grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_admin(uuid) to authenticated;

create or replace function private.add_org_creator_as_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.organization_members(organization_id,user_id,role,status)
  values (new.id,new.created_by,'owner','active');
  return new;
end;
$$;

create trigger organization_creator_membership
after insert on public.organizations
for each row execute function private.add_org_creator_as_owner();

create or replace function private.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id,if_username)
  values (new.id, nullif(new.raw_user_meta_data ->> 'if_username',''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function private.create_profile_for_auth_user();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.aircraft enable row level security;
alter table public.flight_legs enable row level security;
alter table public.crew_requests enable row level security;
alter table public.flight_logs enable row level security;
alter table public.admin_activity enable row level security;

create policy "profiles visible to signed-in users" on public.profiles
for select to authenticated using (true);
create policy "users update own profile" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "members can view their organizations" on public.organizations
for select to authenticated using (private.is_org_member(id));
create policy "signed-in users can create an organization" on public.organizations
for insert to authenticated with check (created_by = (select auth.uid()));
create policy "admins update organization" on public.organizations
for update to authenticated using (private.is_org_admin(id)) with check (private.is_org_admin(id));

create policy "members view membership roster" on public.organization_members
for select to authenticated using (private.is_org_member(organization_id));
create policy "admins manage memberships" on public.organization_members
for all to authenticated using (private.is_org_admin(organization_id))
with check (private.is_org_admin(organization_id));

create policy "members read aircraft" on public.aircraft
for select to authenticated using (private.is_org_member(organization_id));
create policy "admins manage aircraft" on public.aircraft
for all to authenticated using (private.is_org_admin(organization_id))
with check (private.is_org_admin(organization_id));

create policy "members read legs" on public.flight_legs
for select to authenticated using (private.is_org_member(organization_id));
create policy "admins manage legs" on public.flight_legs
for all to authenticated using (private.is_org_admin(organization_id))
with check (private.is_org_admin(organization_id));
create policy "assigned pilots update their legs" on public.flight_legs
for update to authenticated using (pilot_id = (select auth.uid()) or copilot_id = (select auth.uid()))
with check (pilot_id = (select auth.uid()) or copilot_id = (select auth.uid()));

create policy "members view crew requests" on public.crew_requests
for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.flight_legs l
    where l.id = leg_id and private.is_org_admin(l.organization_id)
  )
);
create policy "pilots create own crew requests" on public.crew_requests
for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.flight_legs l
    where l.id = leg_id
      and private.is_org_member(l.organization_id)
      and l.status in ('scheduled','boarding')
  )
);
create policy "admins review crew requests" on public.crew_requests
for update to authenticated using (
  exists (select 1 from public.flight_legs l where l.id = leg_id and private.is_org_admin(l.organization_id))
) with check (
  exists (select 1 from public.flight_legs l where l.id = leg_id and private.is_org_admin(l.organization_id))
);

create policy "members view flight logs" on public.flight_logs
for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.flight_legs l where l.id = leg_id and private.is_org_admin(l.organization_id)
  )
);
create policy "assigned pilots create flight logs" on public.flight_logs
for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.flight_legs l
    where l.id = leg_id
      and private.is_org_member(l.organization_id)
      and (l.pilot_id = (select auth.uid()) or l.copilot_id = (select auth.uid()))
  )
);
create policy "assigned pilots update own flight logs" on public.flight_logs
for update to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.flight_legs l
    where l.id = leg_id
      and (l.pilot_id = (select auth.uid()) or l.copilot_id = (select auth.uid()))
  )
) with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.flight_legs l
    where l.id = leg_id
      and (l.pilot_id = (select auth.uid()) or l.copilot_id = (select auth.uid()))
  )
);

create policy "admins view admin activity" on public.admin_activity
for select to authenticated using (private.is_org_admin(organization_id));
create policy "admins write admin activity" on public.admin_activity
for insert to authenticated with check (private.is_org_admin(organization_id));

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update, delete on public.aircraft to authenticated;
grant select, insert, update, delete on public.flight_legs to authenticated;
grant select, insert, update on public.crew_requests to authenticated;
grant select, insert, update on public.flight_logs to authenticated;
grant select, insert on public.admin_activity to authenticated;
