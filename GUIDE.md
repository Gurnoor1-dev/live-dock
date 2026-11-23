# Virtual Blue — Infinite Flight API v3 Setup Guide

This application uses **Infinite Flight PublicApi v3 as the source of truth** for Virtual Blue's Live organisation, fleet, members, schedules, schedule crew and flight records.

The browser talks only to Next.js `/api/*` routes. Next.js performs OAuth token exchange/refresh and proxies allowlisted requests to Infinite Flight. Supabase email authentication and Supabase-backed fleet records are no longer part of the application flow.

## 1. Requirements

- Node.js 22 or newer and npm
- GitHub repository: `Gurnoor1-dev/live-dock`
- Vercel project: `virtual-blue-live`
- An Infinite Flight OAuth2 **Confidential** client
- A Virtual Blue Live organisation in Infinite Flight, with the users who should access the portal as members

## 2. Create the Infinite Flight OAuth client

1. Open [Infinite Flight API clients](https://infiniteflight.com/account/api-keys).
2. In the **v3 OAuth2 clients** section, create a **Confidential** client (not a Public PKCE client).
3. Add these exact redirect URIs:
   - Local: `http://localhost:3000/api/auth/if/callback`
   - Production: `https://virtual-blue-live.vercel.app/api/auth/if/callback`
4. Request these scopes:
   - `openid`
   - `profile`
   - `offline_access`
   - `live:organizations.read`
   - `live:members.read`
   - `live:aircraft.read`
   - `live:schedules.read`
   - `live:schedules.write`
5. Keep the client secret private. The app uses authorization code + PKCE, exchanges the code on the server, and never sends the client secret to the browser.

New OAuth clients start in Testing. Testing allows the owner and up to five invited test users. Submit the app for review in Infinite Flight when you need all pilots to sign in.

## 3. Configure environment variables

Copy `.env.example` to `.env.local` for local development:

```env
IF_OAUTH_CLIENT_ID=your_confidential_client_id
IF_OAUTH_CLIENT_SECRET=your_confidential_client_secret
IF_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/if/callback
IF_SESSION_SECRET=base64_encoded_32_byte_secret
ADMIN_CREDENTIALS_SECRET=separate_base64_encoded_32_byte_secret
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_PUBLIC_KEY=your_discord_application_public_key
CRON_SECRET=strong_random_bearer_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate independent AES-256-GCM secrets with `openssl rand -base64 32`. Generate a separate high-entropy `CRON_SECRET`. Never commit `.env.local`, publish the client/bot secret, or put server secrets in `NEXT_PUBLIC_*` variables.

### Vercel production variables

The Vercel project `virtual-blue-live` already has the Infinite Flight OAuth values, `IF_SESSION_SECRET`, `ADMIN_CREDENTIALS_SECRET`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `CRON_SECRET` configured. Before enabling Discord, add:

| Name | Value |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_PUBLIC_KEY` | Discord application public key |

The Discord bot token and public key are not currently configured. Do not send them in chat; add them as server-only Vercel environment variables. The interactions endpoint is `https://virtual-blue-live.vercel.app/api/discord/interactions`.

## 4. Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then choose **Continue with Infinite Flight**. The OAuth callback must match the URI registered in the Infinite Flight client.

Before pushing:

```bash
npm run lint
npm run typecheck
npm run build
```

## 5. How authentication works

1. The browser navigates to `/api/auth/if/login`.
2. Next.js generates OAuth state and a PKCE verifier/challenge, then redirects to Infinite Flight.
3. Infinite Flight authenticates the pilot and returns an authorization code to `/api/auth/if/callback`.
4. Next.js validates state and exchanges the code at `https://api.infiniteflight.com/auth/v2/connect/token`, including the confidential client secret and PKCE verifier.
5. Access and refresh tokens are encrypted with AES-256-GCM and stored in an HTTP-only, Secure-in-production cookie.
6. Next.js refreshes expiring tokens server-side and stores the newest rotated refresh token.
7. Sign out clears the app session cookie.

There is no Virtual Blue email/password login, no Supabase email login and no anonymous Supabase account creation in the app.

## 6. API routing and data ownership

All browser API requests go to the Next.js catch-all route:

`/api/if/*` → `https://api.infiniteflight.com/public/v3/*`

The route validates the path/method against the supported PublicApi v3 endpoint allowlist, adds the bearer token on the server, forwards the response and rate-limit headers, and returns no-store browser responses.

The app currently uses these Live organisation endpoints:

- `GET /live/organizations`
- `GET /live/organizations/{organizationId}/aircraft`
- `GET /live/organizations/{organizationId}/members`
- `GET /live/organizations/{organizationId}/schedules`
- `POST /live/aircraft/{aircraftId}/schedules`
- `PUT /live/schedules/{scheduleId}`
- `PUT /live/schedules/{scheduleId}/flightplan`
- `PUT /live/schedules/{scheduleId}/crew/{userId}`
- `DELETE /live/schedules/{scheduleId}/crew/{userId}`
- `PUT /live/aircraft/{aircraftId}/schedules/reorder`
- `DELETE /live/schedules/{scheduleId}`

The proxy also allowlists the documented public sessions, flights, ATC, user, airport, aircraft-reference and related read endpoints.

**Permissions:** members can read their organisation's data. Only Infinite Flight organisation owners (role 2) and admins (role 1) can write schedules or manage schedule crew. The API remains the final permission authority.

**Aircraft limitation:** PublicApi v3 documents aircraft read/position/flight-log endpoints, but no endpoint to add or delete organisation aircraft. Aircraft records must be managed in Infinite Flight's own Live organisation portal.

## 7. Infinite Flight data rules — mandatory

Read and follow the official [API usage and data rules](https://infiniteflight.com/guide/developer-reference/api-rules/usage-and-data-rules) before enabling the portal for pilots.

- Do not persist raw Live API responses, aircraft positions, telemetry, flight logs, pilot flight-time records, historical responses or statistics derived from those responses.
- Infinite Flight explicitly permits keeping the IDs needed to make API requests, OAuth tokens, the link between a user's app account and Infinite Flight account, and user-entered app data. Neon stores those IDs plus app-generated request/approval/automation state; it does not store raw API snapshots.
- The browser workspace uses a 90-second in-memory cache. It is not durable and is not shared across users or devices.
- Dashboard polling pauses when the tab is hidden and after 15 minutes without user interaction.
- My Flights fetches the signed-in user's online logbook when opened and pages it on demand. No flight history is persisted in Neon.
- Organisation activity and hub counts are calculated from current API responses when the page is opened; they are not saved to the database.
- Discord messages are event-time notifications. Do not read old Discord messages back as a data store, and do not post accumulated history or summaries.
- Automation workers poll only the endpoints required for their event notices. Do not expand them into general-purpose background data collection.
- Do not use Live API data to train, fine-tune, evaluate or improve AI/ML models. Use it only for simulated-flight features.

## 8. Rate limits and refresh behaviour

- User token: 5 requests/minute; 20/minute for a user with Infinite Flight Pro.
- The API returns `X-User-Pro` and `X-Rate-Limit-Remaining`; automation workers use the remaining-request header to size rotating scan batches and leave room for the fleet/schedule requests.
- `GET /sessions`: no more often than every 10 minutes.
- Session flight lists, ATC and airport status: no more often than every 15 seconds.
- User/profile-style endpoints: 5 minutes.
- Aircraft/airport reference data: 60 minutes.
- On HTTP 429, respect the upstream `Retry-After` header before retrying.
- The shared dashboard refresh interval is 90 seconds while visible and active; polling stops after 15 minutes of inactivity and while the tab is hidden.
- Server-side automation runs every five minutes, with Auto-Crew, Schedule Reviser and Notifier staggered at different minutes. Batch size adapts to the connected administrator's remaining request budget.
- Vercel Cron jobs do not run until a production deployment containing `vercel.json` is made. Cron frequency also depends on the project's Vercel plan.

## 9. Supabase status

Supabase is no longer used by the running app for sign-in, organisation data, aircraft, schedules, crew or API response storage. The old Supabase schema/migrations may still exist in the previously connected Supabase project, but the new app does not query or write to them.

Do not manually delete those old tables unless you have confirmed nothing else uses that Supabase project and you explicitly want the database objects removed.

## 10. Deployment

The intended production URL is:

`https://virtual-blue-live.vercel.app`

After the Vercel project is connected to GitHub and the production environment variables are set:

1. Deploy the reviewed branch/commit.
2. Verify the project domain is assigned to `virtual-blue-live.vercel.app`.
3. Confirm the exact production redirect URI is registered in the Infinite Flight OAuth client.
4. Sign in with an invited test user.
5. Verify the user's Virtual Blue organisation appears, then check fleet, members and schedules.
6. Test schedule creation and crew assignment with an organisation owner/admin account.
7. Test that a normal member cannot write schedules.
8. Submit the OAuth client for Infinite Flight review before inviting the wider pilot group.

## 11. Troubleshooting

- **`configuration` on login:** add the four server environment variables to Vercel and redeploy.
- **OAuth redirect mismatch:** the redirect URI must exactly match the URI registered in Infinite Flight, including scheme, host and path.
- **403 from `/live/*`:** confirm the OAuth client has the requested `live:*` scope, the app is enabled, the user is a member of the organisation, and the user has the required owner/admin role for writes.
- **No organisation returned:** the signed-in Infinite Flight account is not a member of an active Live organisation.
- **429:** wait for `Retry-After`; do not retry early.
- **Session expires:** confirm `offline_access` was granted and the newest refresh token is being stored.

## 12. Implementation status

**Implemented in source:** Infinite Flight OAuth2 confidential-client login with PKCE, encrypted cookie session and refresh-token rotation; per-admin encrypted operator sessions; app verification with single-use application codes; fleet accordion schedules and seat requests; Discord Components V2 message builders and signed interaction handling; My Flights; Organisation Dock activity/hub estimates; admin schedule, application, user, integration and feature pages; 90-second shared workspace refresh; Auto-Crew, Schedule Reviser and Notifier workers; five-minute staggered cron configuration.

**Runtime setup still required:** add `DISCORD_BOT_TOKEN` and `DISCORD_PUBLIC_KEY` to Vercel, invite/configure the bot, set the Discord interactions endpoint to `https://virtual-blue-live.vercel.app/api/discord/interactions`, and configure channel/role IDs in Admin → Integrations. The cron secret and admin credential encryption key are already configured in Vercel.

**Verification:** the latest GitHub CI run completed lint, TypeScript and production build successfully. The Neon migration was tested on a temporary branch, applied to the production branch and the new tables/indexes were verified. No Vercel deployment was created; the production deployment remains unchanged.

**Important:** obtain Infinite Flight's written approval for storing Live API references and sending organisation/flight details to Discord before enabling these workflows for pilots. The cron jobs are dormant until a deployment is made.

## 13. Neon Postgres with Drizzle

The application uses Neon Postgres through a server-side pooled `DATABASE_URL` and Drizzle ORM. It does not require Neon Auth, AI Gateway, Functions, or Realtime services.

### Connection variables

- `DATABASE_URL`: pooled connection for application requests (hostname contains `-pooler`).
- `DATABASE_URL_UNPOOLED`: direct, non-pooled connection used only for Drizzle migrations.

Both are sensitive Vercel environment variables. Never expose either through a `NEXT_PUBLIC_*` variable or commit them.

### Schema and migrations

Migrations are committed under `drizzle/` with the journal at `drizzle/meta/_journal.json`. `0000_initial_app_settings.sql` creates `public.app_settings`; `0001_virtual_blue_operations.sql` adds application codes, user verification, Discord settings, crew requests, active crew assignments, per-admin operator sessions, automation alerts, audit logs and the notification outbox.

The `app_settings` columns are `key` (text primary key), `value` (JSONB, default `{}`) and `updated_at` (timestamptz).

Run schema changes through Drizzle:

```bash
npm run db:generate
npm run db:migrate
```

`drizzle.config.ts` prefers `DATABASE_URL_UNPOOLED` and rejects a pooled hostname. Application queries use pooled `DATABASE_URL`.

### Application data boundaries

Use `src/lib/db/app-settings.ts` for app-owned settings CRUD. The operations schema stores onboarding and application workflow state; it does not store raw Live API responses, aircraft positions, telemetry or flight-log payloads. It does store schedule/aircraft/user references required to process pilot requests and automation. Confirm with Infinite Flight that retaining these references is permitted before production use, as described in section 7. OAuth2 authentication and encrypted HTTP-only sessions remain in Next.js; Neon Auth is not used.

### Health check

`/api/health/database` executes a query against `public.app_settings` and returns `databaseResponseTimeMs` plus a `Server-Timing` header. This measures the database query round trip, not total browser-to-function latency. Compare it with the previously observed Supabase baseline of 150 ms.
