# Virtual Blue Fleet Operations

A Next.js 16 + React 19.3 fleet operations portal for Virtual Blue, backed by Supabase.

## Included in this first implementation

- Responsive Virtual Blue operations shell and branding
- Fleet overview with aircraft search, filters, status counts and empty states
- Operations board and published schedules
- Navigation for Flight bag, Airline, My activity, Aircraft history and Admin
- Supabase Auth email magic-link sign-in using SSR cookies
- Supabase Postgres schema with organization membership roles and row-level security
- Server-side fleet API route and a practical setup guide

The original ZIP assets and the newly supplied HTML reference remain preserved in [example/](./example/). The Next.js app is a clean React implementation; it does not load the legacy global-script page directly.

## Quick start

1. Install Node.js 22 or newer.
2. Copy `.env.example` to `.env.local`.
3. Add the Supabase publishable key from the Live Dock project.
4. Apply `supabase/migrations/202611210001_virtual_blue_fleet.sql` in Supabase SQL Editor.
5. Run `npm install`, then `npm run dev`.
6. Open http://localhost:3000.

Read [GUIDE.md](./GUIDE.md) before enabling production access.

## Important integration boundary

The reference HTML uses Infinite Flight OAuth2/PKCE and a separate INVA API service. The supplied frontend files do not include that backend service or its credentials. This project replaces the fleet database layer with Supabase. Infinite Flight OAuth, SimBrief, dispatch, live tracking, crew booking and admin CRUD require verified provider details and the follow-on implementation described in GUIDE.md. No credentials are hard-coded.
