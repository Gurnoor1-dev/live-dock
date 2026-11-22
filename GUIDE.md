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
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate the session encryption key with:

```bash
openssl rand -base64 32
```

Use a different strong secret in each environment. Never commit `.env.local`, publish the client secret, or put server secrets in `NEXT_PUBLIC_*` variables.

### Vercel production variables

In Vercel → `virtual-blue-live` → Settings → Environment Variables, add the following for **Production** (and Preview if needed):

| Name | Value |
| --- | --- |
| `IF_OAUTH_CLIENT_ID` | Client ID from Infinite Flight |
| `IF_OAUTH_CLIENT_SECRET` | Client secret from Infinite Flight |
| `IF_OAUTH_REDIRECT_URI` | `https://virtual-blue-live.vercel.app/api/auth/if/callback` |
| `IF_SESSION_SECRET` | A unique output from `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | `https://virtual-blue-live.vercel.app` |

Redeploy after adding or changing environment variables. Do not send the client secret or session secret in chat or commit them to GitHub.

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

The Infinite Flight API owns its returned data. This app must follow the official [API usage and data rules](https://infiniteflight.com/guide/developer-reference/api-rules/usage-and-data-rules):

- Do not write API responses or derived API data to Supabase/Postgres, files, logs, exports or analytics storage.
- Do not accumulate historical responses, tracks, replays, flight logs, statistics, scores or leaderboards.
- A cache may keep only the latest response per request. Replace it on refresh.
- Cache at least the documented minimum polling interval and discard live/user data no later than one hour after fetching.
- Stop polling after 15 minutes without user activity.
- Do not share user-specific Live data between users or devices.
- Do not use API data to train, fine-tune, evaluate or improve AI/ML models.
- Use API data only for simulated-flight features, not real-world aviation.

The Next.js proxy uses process-memory TTL caching only. Cache keys are scoped by a one-way hash of the signed-in access token plus a random HTTP-only device identifier, so cached Live data is not shared across a user's devices. They are not written to a database or logs, and are invalidated after schedule mutations. The current dashboard refreshes on user action and does not run a background polling loop.

The app keeps only OAuth tokens in an encrypted, HTTP-only cookie. It does not persist Infinite Flight API responses in backend tables. User-entered preferences can be added later, provided they are not copies or derived records of API data.

## 8. Rate limits and refresh behaviour

- User token: 5 requests/minute; 20/minute for a user with Infinite Flight Pro.
- `GET /sessions`: no more often than every 10 minutes.
- Session flight lists, ATC and airport status: no more often than every 15 seconds.
- User/profile-style endpoints: 5 minutes.
- Aircraft/airport reference data: 60 minutes.
- On HTTP 429, respect the upstream `Retry-After` header before retrying.
- Do not poll while the portal is idle or hidden. The current implementation is manual-refresh only.

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

**Implemented:** Infinite Flight OAuth2 confidential-client login with PKCE, encrypted cookie session, refresh-token rotation, sign-out, Next.js-only API proxy, method/path allowlist, in-memory TTL cache, organisation list, fleet read view, member list, schedule read view, schedule creation/deletion and crew assignment UI.

**Available through the API proxy but not yet surfaced in the UI:** public live sessions/flight tracker views, individual aircraft position/flight logs, schedule editing, flight-plan updates, crew reordering and schedule reordering.

**Not provided by PublicApi v3:** organisation aircraft creation/deletion. Manage those in Infinite Flight.

The original Fleet Mode assets and `example/fleet.html` remain under `example/` as a visual/behaviour reference.


## 8. Neon Postgres with Drizzle

The application uses Neon Postgres through a server-side pooled `DATABASE_URL` and Drizzle ORM. It does not require Neon Auth, AI Gateway, Functions, or Realtime services.

### Connection variables

- `DATABASE_URL`: pooled connection for application requests (hostname contains `-pooler`).
- `DATABASE_URL_UNPOOLED`: direct, non-pooled connection used only by Drizzle migrations.

Both variables are stored as sensitive Vercel environment variables for Production, Preview and Development. For local work, put both in `.env.local`. Never expose either through a `NEXT_PUBLIC_*` variable or commit them.

### Schema and migrations

The initial migration is committed at `drizzle/0000_initial_app_settings.sql`, with its journal at `drizzle/meta/_journal.json`. It creates `public.app_settings` with:

- `key` — text primary key
- `value` — non-null JSONB, default `{}`
- `updated_at` — non-null timestamptz, default `now()`

Run schema changes through Drizzle:

```bash
npm run db:generate
npm run db:migrate
```

`drizzle.config.ts` prefers `DATABASE_URL_UNPOOLED` and rejects a pooled hostname, so migrations cannot accidentally run through PgBouncer. Application queries continue to use pooled `DATABASE_URL`.

### Application data boundaries

Use `src/lib/db/app-settings.ts` for app-owned settings CRUD (`getAppSetting`, `setAppSetting`, `deleteAppSetting`). This is a small configuration store, not a mirror of Infinite Flight.

Infinite Flight remains the source of truth for live organisation, aircraft, members, schedules and flight records. Do not copy API responses, positions, telemetry, or derived live data into Postgres. Existing OAuth2 authentication and encrypted HTTP-only session cookies remain in Next.js; Neon Auth is not used. Vercel Blob continues to hold aircraft gallery files and its existing gallery manifest.

### Health check

`/api/health/database` executes a query against `public.app_settings` and returns `databaseResponseTimeMs` plus a `Server-Timing` header. This measures the database query round trip, not total browser-to-function latency. Compare it with the previously observed Supabase baseline of 150 ms.
