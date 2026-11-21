# Virtual Blue — Setup & Operations Guide

This guide covers local development, the Live Dock Supabase project and production setup.

## 1. Prerequisites

- Node.js 22 or newer and npm
- Access to Supabase project **Live Dock** (`npsftsvbcqkwsjtlgckj`)
- GitHub access to `Gurnoor1-dev/live-dock`
- Vercel account for hosting
- Infinite Flight OAuth application details before enabling IF account linking

## 2. Local environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Set:

```env
NEXT_PUBLIC_SUPABASE_URL=https://npsftsvbcqkwsjtlgckj.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Get the publishable key from Supabase Dashboard → Project Settings → API Keys. It is safe for browser use when RLS is configured. Never put a Supabase secret/service-role key in a `NEXT_PUBLIC_*` variable or commit it to GitHub.

## 3. Database setup

The initial schema and its two hardening migrations have already been applied to the Live Dock project. For a fresh Supabase project or a full rebuild, run these SQL files in this exact order from Supabase Dashboard → SQL Editor:

1. `supabase/migrations/202611210001_virtual_blue_fleet.sql` — core tables, roles, triggers and RLS.
2. `supabase/migrations/202611210002_rls_and_indexes.sql` — tighten policy overlap and add foreign-key indexes.
3. `supabase/migrations/202611210003_profile_privacy_and_leg_integrity.sql` — restrict pilot profile visibility and validate same-organization aircraft/pilot assignments.

Confirm that all eight public tables appear in Table Editor and that RLS is enabled on each. Do not blindly rerun a migration after a partial failure; inspect the completed objects and migration history first.

The security advisor was checked after setup and returned no findings. Performance advisor currently reports only unused-index notices because the tables are new and do not yet contain production traffic.

## 4. Supabase Auth

In Supabase Dashboard → Authentication → URL Configuration:
- Set Site URL to your local origin during development.
- Add `http://localhost:3000/auth/callback`.
- Later add your production URL and `https://YOUR-DOMAIN/auth/callback`.

Enable Email as an auth provider. Configure SMTP before public launch. The app signs pilots in with email magic links and exchanges the PKCE code in the callback route.

The first signed-in user without an organization sees the workspace setup form. Creating the Virtual Blue organization automatically makes that user its owner. The Admin tab includes initial forms to register aircraft and publish flight legs; editing, deletion and member invitation screens remain follow-on work.

## 5. Run and validate locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Before pushing, run:

```bash
npm run typecheck
npm run build
```

Commit the generated `package-lock.json` (or your chosen package manager lockfile) to make builds reproducible.

## 6. Infinite Flight account linking

The reference `example/fleet.html` confirms the original frontend used Infinite Flight OAuth2 with PKCE, then called a separate INVA API origin. The provided source package contains frontend assets; it does not include the INVA API service, OAuth client credentials, token storage or API implementation.

Do not guess OAuth endpoints. Obtain the official authorize URL, token URL, client ID, client secret (if required), redirect URI and scopes from the Infinite Flight OAuth application you control. Keep client secrets server-side. The current app uses Supabase email auth for portal access; Infinite Flight identity linking is a separate integration and must be implemented against the verified provider contract.

## 7. SimBrief and dispatch

The reference includes a SimBrief helper and flight dispatch modules. The database has a pilot `simbrief_username` and a leg `simbrief_ofp_id` field, but OFP retrieval, dispatch calculations, crew booking and flight plan submission are not yet wired to production APIs. Add these only after confirming the relevant SimBrief and Infinite Flight API contracts and usage limits.

## 8. Vercel deployment

1. Import `Gurnoor1-dev/live-dock` into Vercel.
2. Select `feat/virtual-blue-fleet-app` for the preview deployment.
3. Add the Supabase URL and publishable key in Project Settings → Environment Variables.
4. Add the Vercel preview URL plus `/auth/callback` to Supabase redirect URLs.
5. Deploy and test email sign-in, session refresh, RLS and mobile layouts.
6. When a custom domain is ready, add it in Vercel and update Supabase Site URL and redirect URLs.

## 9. Go-live checklist

- [ ] Add the Supabase publishable key locally and in Vercel.
- [ ] Apply the SQL migration and verify RLS is enabled on every public table.
- [ ] Configure email delivery and redirect URLs.
- [ ] Create the first Virtual Blue owner account and organization.
- [ ] Add pilot memberships and verify a pilot cannot administer the fleet.
- [ ] Build and test aircraft/schedule admin CRUD.
- [ ] Configure verified Infinite Flight OAuth and secure token storage.
- [ ] Connect SimBrief, dispatch, crew requests and live tracking.
- [ ] Run `npm run typecheck` and `npm run build`.
- [ ] Test production sign-in, sign-out, permissions and mobile layout.

## 10. Feature status

**Implemented:** Next.js 16 app shell, Virtual Blue branding, fleet overview, aircraft search/filter, operations board, schedule read view, organization onboarding, initial aircraft and flight-leg creation forms for admins, email magic-link authentication, SSR proxy session refresh, Supabase schema and RLS.

**Still to build:** aircraft/leg edit and delete screens, member invitation and role management, IF OAuth linking and token persistence, crew seat request/review workflow, live tracking/polling, interactive route globe, complete flight bag, SimBrief OFP import, dispatch tools, aircraft history and pilot activity analytics.

The source reference remains in `example/` unchanged for continued feature-by-feature porting. This is a functional foundation, not a claim that every legacy backend-dependent feature is already live.
