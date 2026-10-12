# Phase 4 dashboard foundation

The approved build plan calls for the visual system, OAuth, permissions, guild navigation, service overview, status cards and error states before feature-specific forms. This phase implements that foundation at `/dashboard`; bot settings forms and deployment are separate work.

## What is available

- Kafka-themed wine, ivory and gold command center with a server switcher, local bot/module search, recent-incident indicator and account menu. Desktop sidebar becomes a mobile menu. Local Kafka artwork, animated silk and butterflies, and locally served Outfit/Nunito Sans fonts require no third-party requests at runtime. Character motion includes pause and reduced-motion support.
- Registry-driven bot cards with process, Discord gateway and database status, latency and heartbeat time. Selecting a card opens its health/provider/module details. No fixed bot count is imposed by the overview API.
- Guild-scoped recent security incidents and configuration history. Incident details require the security scope. Counts mean the latest recorded events, not unresolved/open incidents. Recent actions show saved versions; a saved version is not claimed to be confirmed by a bot.
- Acknowledged loading states, empty registries, unavailable views, revoked access, stale heartbeats and failed refreshes. Last snapshots are retained on temporary failures and labeled stale; authorization denial removes them. Refresh every 30 seconds while the page is visible, plus manual refresh and refresh on returning to the tab.
- Keyboard focus, `/` to focus search, Escape to dismiss menus/details, native modal focus containment and reduced-motion styles.

The demo is visibly marked and remains a separate development-only API process. Production never falls back to fixtures. Host CPU/RAM/disk and live bot configuration controls are not invented in this phase.

## Authentication and authorization

Discord OAuth requests `identify`, `guilds` and `guilds.members.read`. The five-minute signed state must match the HttpOnly cookie from the same browser. The callback exchanges the code, looks up the profile and writes a server-side PostgreSQL session; the browser receives a signed session reference, not the provider token. Provider tokens are encrypted with AES-256-GCM using a key derived from `SESSION_SECRET`. Rotating that secret invalidates existing sessions. Sessions expire after the lesser of the provider token lifetime and eight hours; users sign in again rather than storing refresh tokens.

Every private read checks that the server-side session is active. Guilds must be approved locally and present in the current Discord membership list. Discord owners, administrators and members with Manage Server receive all dashboard scopes. Other staff need a matching role from `access.staff_roles`; they receive `overview` plus the assigned scopes. The role lookup uses the member-read scope. Permission checks have a shared 12-second provider deadline and fail closed if Discord is unavailable or rate limited. There is no fallback to a cached local owner ID.

Private responses use `Cache-Control: no-store`. Logout requires a session-bound `x-csrf-token`, revokes the database session and clears the cookie. All future mutating `/api/` routes inherit the CSRF gate and still need their own guild/module authorization. UI visibility alone is never authorization.

Service health is currently process-wide because `ops.service_status` has one row per service; bot assignments and histories are guild-specific. A heartbeat older than 60 seconds, missing, invalid or materially in the future becomes unknown rather than healthy. An unknown provider signal does not mean an external provider has been checked. The API pool is bounded to ten connections with connection/statement timeouts; this retains the build plan's VPS budget.

## Setup and rollout

The Kafka character redesign supersedes the initial dashboard art and palette. See [Kafka frontend](kafka-frontend.md) for the locally served illustration, browser animation, pause control and reduced-motion behavior.

1. Install with the pinned Node 24.8.0/pnpm 9.12.0 and `pnpm install --frozen-lockfile`.
2. Back up PostgreSQL and run `pnpm migrate` using a migration operator. Apply migration `005_dashboard_sessions.sql` after the preceding migrations. Apply/reapply `infra/postgres/roles.sql` under the migration owner to grant access to new tables/columns and sequences. The API must use the restricted application login, never the bootstrap superuser.
3. Register a Discord OAuth application and set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `OAUTH_REDIRECT_URL`, `SESSION_SECRET` and `CSRF_SECRET`. Secrets must each contain at least 32 characters. The redirect URL must exactly match the Discord application setting, e.g. `https://your-host/api/auth/callback`. Use one public origin behind the existing VPS ingress/Nginx.
4. Approve the intended guild in `access.guilds`. Configure `access.staff_roles` for staff who do not already own/manage the guild. Populate `config.bots` with actual application IDs, module lists and `guild_ids`. Empty registries intentionally show no assigned bots. Do not copy sample IDs from fixtures.
5. Start the API and dashboard. Local API uses `DATABASE_URL`, default port 3001; the dashboard uses `API_INTERNAL_URL=http://localhost:3001` for same-origin `/api/` proxying. Public website server-rendered catalog views use `NEXT_PUBLIC_API_BASE`. For local HTTP only, explicitly set `COOKIE_SECURE=false` in a nonproduction API process. Production forces Secure cookies, and requires HTTPS at ingress.
6. Build Linux release images outside the live VPS hot path. The dashboard Docker build sets `NEXT_STANDALONE=true`; Windows validation uses normal Next output to avoid standalone symlink privileges. The Docker runtime starts the traced workspace server at `apps/dashboard/server.js` and includes local public/static assets. Both web/API images run as the Node user. Resolve immutable image references in `compose.prod.yml` before launch. Compose now supplies OAuth credentials to the API and routes `/api/` without stripping its prefix.

Old Phase 4 cookies lacking the new database session reference are intentionally rejected; staff sign in again after migration. Application rollback to the old API would undo these access protections and must not be used as a routine release fallback. Database restoration remains an explicit operator recovery action.

## Contract and checks

The foundation OpenAPI contract is served at `/api/openapi.json` and lives in `apps/api/src/openapi.json`. Run `pnpm generate:dashboard-api` after contract changes to regenerate `packages/contracts/src/dashboard-api.ts`; the dashboard account client uses these generated types. Public catalog/order endpoints are retained separately and are not covered by this foundation contract.

- `pnpm --filter @ei-point/api test`: 20 tests covering sessions, OAuth/state, CSRF, authorization denial, staff scopes, missing provider permissions, stale health, secret-safe errors, token encryption and the published contract.
- `pnpm test:phase4`: disposable real PostgreSQL test covering migrations, the OAuth callback/session lifecycle, encrypted storage, scoped registry data, approval removal and logout revocation. It does not contact Discord or use production credentials.
- `pnpm typecheck`, `pnpm build`, `pnpm test`: workspace verification including the Phase 6 regression suite.
- Browser QA exercised `/dashboard` on desktop and 390px mobile, search, guild switching, modal/Escape, reduced motion, failed-refresh snapshots and sign-in with no page errors. The Browser plugin was unavailable; bundled Playwright with installed Edge was used. Preview fixtures and browser-intercepted failures do not certify real Discord integration.

Development uses `.next`; production builds use `.next-production` so a running dev server cannot overwrite release files. Local checks were run on Node 24.21.0; the repository and Docker pin remains 24.8.0. Staging must verify the exact pinned release runtime and the benchmark VPS CPU instruction set.

Before marking production ready, build the Linux images, verify same-origin HTTPS cookies/OAuth with the real application, exercise owner/manager/staff/ordinary-member denial in both approved guilds, verify role revocation, check real heartbeat producers and validate backup/restore of encrypted sessions. The build plan's full-fleet load and 72-hour soak gates remain open. No deployment or push was performed by this phase implementation.
