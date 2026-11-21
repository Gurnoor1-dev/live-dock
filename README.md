# Virtual Blue — Fleet Operations

A Next.js 16 + React 19 application using Infinite Flight PublicApi v3 as the source of truth for Virtual Blue Live organisation data.

- Infinite Flight OAuth2 sign-in (Confidential client + PKCE)
- Encrypted HTTP-only session cookies and refresh-token rotation
- All browser API calls routed through Next.js `/api/*`
- Organisation, aircraft, members and schedule views
- Schedule creation/deletion and crew assignment for Infinite Flight admins
- Process-memory TTL caching only; no permanent API response storage

See [GUIDE.md](./GUIDE.md) for OAuth client setup, Vercel environment variables, data rules, local development and deployment.

**Production target:** https://virtual-blue-live.vercel.app

Infinite Flight API data is subject to its [official usage and data rules](https://infiniteflight.com/guide/developer-reference/api-rules/usage-and-data-rules).