<div align="center">

<img src="docs/assets/ei-point-pulse.gif" alt="Animated Ei Point signal traveling through the bot fleet" width="100%" />

<h1>EI POINT</h1>

<p><strong>A modular Discord platform for communities, creators, and operators.</strong><br />
Six identities. Shared domain services. Durable state. Controlled releases.</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-24.8-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 24.8" />
  <img src="https://img.shields.io/badge/pnpm-9.12-F69220?style=for-the-badge&logo=pnpm&logoColor=white" alt="pnpm 9.12" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5.6" />
  <img src="https://img.shields.io/badge/PostgreSQL-17-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL 17" />
  <img src="https://img.shields.io/badge/Status-In%20Development-C05A4B?style=for-the-badge" alt="In development" />
</p>

<p>
  <a href="#platform">PLATFORM</a> &nbsp;·&nbsp;
  <a href="#%EF%B8%8F-architecture">ARCHITECTURE</a> &nbsp;·&nbsp;
  <a href="#-quick-start">QUICK START</a> &nbsp;·&nbsp;
  <a href="docs/bot-command-catalog.md">BOT COMMANDS</a> &nbsp;·&nbsp;
  <a href="#-operations-1">OPERATIONS</a> &nbsp;·&nbsp;
  <a href="#-readiness">READINESS</a>
</p>

</div>

> [!IMPORTANT]
> **Development build · production readiness is not certified.** Legacy feature parity, fleet-wide lifecycle adoption, Linux/VPS qualification, live integrations, and recovery/soak acceptance still have open gates. See [Readiness](#readiness) and the [phase gates](docs/phase-gates.md).

## ✦ Platform

Ei Point is a TypeScript and Python monorepo for a coordinated fleet of Discord bots and a Kafka-themed public site/dashboard. Reusable domain modules sit behind independent gateway processes, an API, background workers, PostgreSQL, and release tooling. PostgreSQL owns durable business state; immutable release manifests select the services and identities to run.

<a id="platform"></a>

<table>
  <tr>
    <td width="50%"><h3>🛡️ Protection &amp; moderation</h3><p>Scoped moderation, raid and antinuke logic, lockdown/restoration support, incident records, and audit-oriented event handling.</p></td>
    <td width="50%"><h3>🎴 Community &amp; games</h3><p>Welcome flows, XP and leaderboards, cards, packs, inventories, listings, and trades backed by durable state.</p></td>
  </tr>
  <tr>
    <td width="50%"><h3>◈ Commerce &amp; referrals</h3><p>Catalog and order flows, payment claims and settlement, verification, referral cycles, and guarded fulfillment.</p></td>
    <td width="50%"><h3>✦ AI, voice &amp; music</h3><p>Bounded provider routing and memory, Cyrene TTS, and Robin playback with queue snapshots and a bounded media cache.</p></td>
  </tr>
  <tr>
    <td width="50%"><h3>⌘ Website &amp; API</h3><p>A Kafka-themed public site and dashboard foundation with OAuth/session controls, commerce endpoints, and readiness routes.</p></td>
    <td width="50%"><h3>⟲ Operations</h3><p>Database migrations, health checks, immutable release manifests, deploy/rollback helpers, backups, and recovery procedures.</p></td>
  </tr>
</table>

These describe the implemented product surface, not a claim that every archived behavior or live integration has passed acceptance.

## ◈ The fleet

| Identity | Service key | Intended responsibilities | Current acceptance status |
|---|---|---|---|
| **Kafka** | `kafka` | Security, moderation, logging | Local implementation; full shared-dispatch lifecycle and live Discord acceptance remain open |
| **Cyrene** | `cyrene` | AI, search, TTS | Provider, voice playback, restart, and lifecycle acceptance remain open |
| **Robin** | `robin` | Music and playback | Target-platform playback and lifecycle acceptance remain open |
| **Cipher** | `cipher` | Commerce and referrals | Local guarded flows; live provider/payment and full acceptance remain open |
| **SilverWolf** | `silverwolf` | Community and games | Local implementation; catalog/legacy parity and staging acceptance remain open |
| **Himiko** | `himiko` | Embeds and announcements | Local delivery intent support; live Discord delivery acceptance remains open |

The bot count is configurable through the release roster. A manifest cannot create a bot: each identity also needs application code, Compose service, token/secret wiring, health checks, registry configuration, and verified permissions. See [bot identities](docs/bot-identities.md) and [release operations](docs/operations-release.md).

Browse the [individual command and function catalog for all six bots](docs/bot-command-catalog.md). It follows checked-in command definitions and distinguishes implemented source behavior from the still-open legacy parity and live acceptance gates.

The owner-approved target command set is documented command by command in the [product command and runtime spec](docs/product/bot-command-and-runtime-spec.md). This spec records requested behavior separately from code that has passed its implementation gates.

## ⚙️ Architecture

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#171c29','primaryTextColor':'#eef2f7','primaryBorderColor':'#b95348','lineColor':'#a98b71','secondaryColor':'#20283a','tertiaryColor':'#111722','clusterBkg':'#0e1420','clusterBorder':'#39435a','fontFamily':'ui-sans-serif, system-ui, sans-serif'}}}%%
flowchart TB
  subgraph Experience["01 · EXPERIENCE"]
    direction LR
    Members[Members & operators]
    Discord[Discord]
    Site[Kafka-themed site]
  end
  subgraph Services["02 · APPLICATION SERVICES"]
    direction LR
    API[Fastify API]
    Fleet[Six bot identities]
    Workers[Workers & outbox]
  end
  subgraph Core["03 · SHARED PLATFORM"]
    direction LR
    Flow[Ei-Flow lifecycle]
    Domain[Domain modules]
    DB[(PostgreSQL)]
    Ops[Release · health · recovery]
  end
  Members --> Discord
  Members --> Site
  Site --> API
  Discord --> Fleet
  Fleet --> Flow
  Flow --> Domain
  API --> DB
  Domain --> DB
  API --> Workers
  Workers --> DB
  Ops --> API
  Ops --> Fleet
  Ops --> DB
  style Experience fill:#101722,stroke:#344157,color:#eef2f7
  style Services fill:#121b2b,stroke:#475066,color:#eef2f7
  style Core fill:#171826,stroke:#7b454d,color:#eef2f7
  classDef actor fill:#1a2536,stroke:#78d6e6,color:#eef6fc,stroke-width:2px
  classDef service fill:#21273a,stroke:#bc6559,color:#fff1e8,stroke-width:2px
  classDef durable fill:#212b36,stroke:#d3ac6c,color:#fff8e8,stroke-width:2px
  class Members,Discord,Site actor
  class API,Fleet,Workers,Flow,Domain,Ops service
  class DB durable
```

<p align="center"><sub>Discord and web traffic enter through separate edges, then meet at shared domain and persistence boundaries.</sub></p>

**Design boundaries:** domain packages do not own Discord clients; authorization and interaction lifecycle code belongs in the shared flow/runtime layer; money, inventory, jobs, and receipts use database transactions and idempotency controls; production deployment selects prebuilt image digests rather than building on the live host.

## 🚀 Quick start

### Prerequisites

- Node.js **24.8.0** and pnpm **9.12.0** (pinned in `.nvmrc` and `package.json`).
- Python **3.12** for the music service and its tests.
- Docker Engine and Docker Compose for local PostgreSQL and containerized services.
- Discord applications, OAuth credentials, and configured providers only for the live flows that need them. Start with a dedicated test guild.

### Install and configure

```bash
git clone https://github.com/xyanncat/Ei-point.git
cd Ei-point
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
```

On Windows PowerShell, replace the final line with `Copy-Item .env.example .env`.

Edit `.env` before starting services. Replace every placeholder secret; configure database, OAuth, guild allowlists, and the selected provider/bot tokens. Keep `.env` private and out of commits. The checked-in values are examples, not deployable credentials.

Start the local PostgreSQL and edge services:

```bash
docker compose --env-file .env -f infra/docker/compose.yml up -d --build postgres nginx
```

Run workspace development processes from the repository root:

```bash
pnpm dev
```

Some services require credentials and database configuration; an unset provider or bot token can keep its corresponding live flow unavailable. Follow [operations](docs/operations.md) and [the release procedure](docs/operations-release.md) for first provisioning, migrations, and deployment. This local start is not production provisioning.

### Environment reference

The complete annotated list is in [`.env.example`](.env.example). Common configuration groups are:

| Group | Variables | Purpose |
|---|---|---|
| PostgreSQL | `POSTGRES_ADMIN_*`, `DATABASE_URL`, `MIGRATION_DATABASE_URL` | Separate bootstrap/migration credentials from the least-privilege application login |
| Discord | `DISCORD_*_BOT_TOKEN`, `DISCORD_TEST_GUILD_ID`, `DISCORD_MAIN_GUILD_ID`, `DISCORD_CLIENT_*` | Bot identities, guild allowlist, and OAuth |
| Web/API | `SESSION_SECRET`, `CSRF_SECRET`, `VAULT_SECRET`, `INTERNAL_SERVICE_TOKEN`, `DASHBOARD_ORIGIN`, `API_PORT` | Session protection, service trust, and local routing |
| AI/TTS | `AI_PROVIDER_PRIMARY*`, `AI_PROVIDER_FALLBACK*`, `AI_DEADLINE_MS`, `AI_DAILY_BUDGET_TOKENS`, `TTS_*` | Provider endpoints, model identifiers, credentials, and bounded usage |
| Commerce | `UPI_PAYEE_*`, `COMMERCE_GUILD_ID`, `PAYMENT_ORIGIN`, `COMMERCE_REFERRAL_REWARD_MINOR` | Payment presentation and guild/referral configuration |
| Backup/ingress | `DEPLOY_BACKUP_MAX_AGE_HOURS`, `RESTIC_*`, tunnel variables | Release backup-age bound and optional external backup/ingress configuration |

Production secrets belong in a protected host-side environment file. Do not put credentials in issues, logs, screenshots, or release manifests.

## 🧰 Development

Install from the lockfile, then run checks from the root:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Focused package commands are available with pnpm filters, for example:

```bash
pnpm --filter @ei-point/flow test
pnpm --filter @ei-point/bot-community build
pnpm test:phase4
pnpm test:phase6
```

The music service has Python unit tests under `apps/bots/music-py/tests/`. Commands that require PostgreSQL or provider credentials need those services/configuration.

### Repository map

```text
apps/
  api/                 Fastify API, authentication, commerce and readiness
  dashboard/           Next.js public site and dashboard
  bots/                Discord gateways and the Python music service
  workers/             Background jobs, outbox, and maintenance work
packages/
  flow/                Shared lifecycle, authorization and runtime controls
  modules/              Domain logic for AI, commerce, games, moderation, music, security, TTS
  contracts/            Shared API and event contracts
infra/
  postgres/             Migrations, roles and database bootstrap
  docker/               Local and production Compose definitions
  backup/               Backup images, scripts, verification and restore helpers
docs/
  acceptance/           Recorded acceptance status and evidence
  audits/               Source inventory and remediation tracking
  operations*.md        Deployment, rollback, backup and recovery runbooks
```

## ⛭ Operations

### Release flow

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#171c29','primaryTextColor':'#eef2f7','primaryBorderColor':'#b95348','lineColor':'#a98b71','secondaryColor':'#20283a','tertiaryColor':'#111722','fontFamily':'ui-sans-serif, system-ui, sans-serif'}}}%%
flowchart TB
  subgraph Prepare["01 · PREPARE RELEASE"]
    direction LR
    Source[Reviewed source] --> Build[Linux build & checks]
    Build --> Digest[Immutable image digests]
    Digest --> Manifest[Release manifest]
  end
  subgraph Rollout["02 · CONTROLLED ROLLOUT"]
    direction LR
    Backup[Verified backup] --> Deploy[Deploy selected roster]
    Deploy --> Health[Health & heartbeats]
  end
  subgraph Acceptance["03 · ACCEPTANCE"]
    direction LR
    Accept[Staging acceptance] --> Cutover[Operator-approved cutover]
  end
  Manifest --> Backup
  Health --> Accept
  classDef gate fill:#171c29,stroke:#bd6558,color:#f4eee9,stroke-width:2px
  classDef evidence fill:#17252a,stroke:#79ced3,color:#e8fbfc,stroke-width:2px
  class Source,Build,Digest,Manifest,Deploy,Cutover gate
  class Backup,Health,Accept evidence
```

<p align="center"><sub>Every production release is digest-pinned and gated on backup, readiness, and operator evidence.</sub></p>

Production starts prebuilt images; the deploy script checks a recent verified backup, immutable image references, migrations, readiness, and fresh service heartbeats. Application rollback restores a compatible image roster; it does **not** reverse migrations or restore an old database. Database recovery is a separate operator-led incident procedure.

Useful references:

- [Operations overview](docs/operations.md)
- [Release, deploy, rollback, and recovery procedure](docs/operations-release.md)
- [Backup tooling and configuration](infra/backup/README.md)
- [Recovery drills](docs/recovery-drills.md)
- [Security boundaries](docs/security.md)
- [Feature matrix and source mapping](docs/feature-matrix.md)

## ◉ Readiness

Local tests and typechecks support ongoing development; they do not prove live behavior or deployment readiness. The current remediation record reports:

- **179 mapping rows** and **228 unresolved coverage issues** in the archive inventory. Each legacy behavior still needs source-to-target-to-test evidence or an explicit approved decision.
- Shared lifecycle adoption for **Himiko, community, and commerce**. Fleet-wide dispatcher adoption and acceptance remain incomplete.
- Linux image builds, first provisioning on the target CPU, live Discord OAuth/permissions and delivery, configured provider/voice behavior, payment reconciliation, and real backup/PITR/off-host restore drills are still to be demonstrated.
- Staging, two-guild load, the 72-hour soak, and production cutover remain open. No production cutover is claimed here.

See the [remediation ledger](docs/audits/2026-10-15-remediation.md), [acceptance records](docs/acceptance/), and [phase gates](docs/phase-gates.md). Update these when evidence changes; do not infer closure from code presence or mocked tests.

## ◷ Roadmap

The completion plan sequences work as **behavioral inventory → reproducible Linux foundation → shared runtime → domain acceptance → recovery → staging and launch**. Track current requirements and exit criteria in the [phase gates](docs/phase-gates.md) and [remediation ledger](docs/audits/2026-10-15-remediation.md).

```mermaid
%%{init: {'theme':'base','themeVariables': {'primaryColor':'#171c29','primaryTextColor':'#eef2f7','primaryBorderColor':'#b95348','lineColor':'#857a78','secondaryColor':'#20283a','tertiaryColor':'#111722','fontFamily':'ui-sans-serif, system-ui, sans-serif'}}}%%
flowchart LR
  Inventory["01 · INVENTORY<br/>Open"] --> Foundation["02 · FOUNDATION<br/>Open"]
  Foundation --> Runtime["03 · RUNTIME<br/>In progress"]
  Runtime --> Domains["04 · DOMAINS<br/>Open"]
  Domains --> Recovery["05 · RECOVERY<br/>Open"]
  Recovery --> Launch["06 · STAGING / LAUNCH<br/>Open"]
  classDef open fill:#171c29,stroke:#75565a,color:#e7dfe0,stroke-width:2px
  classDef active fill:#30251f,stroke:#e0a55f,color:#fff3d7,stroke-width:3px
  class Inventory,Foundation,Domains,Recovery,Launch open
  class Runtime active
```

| Gate | Current state |
|---|---|
| Legacy behavior inventory | Open — unresolved source mappings remain |
| Foundation on target Linux/VPS | Open — clean target-host build and provisioning evidence required |
| Shared runtime across fleet | In progress — adoption is not complete |
| Website and domain acceptance | In progress — live integrations and feature parity remain |
| Backup and recovery | Tooling exists; real restore and off-host acceptance remain |
| Staging and launch | Open — load, soak, recovery, and operator authorization required |

## 🩺 Troubleshooting

| Symptom | Check |
|---|---|
| Workspace install rejects the lockfile | Confirm Node `24.8.0`, pnpm `9.12.0`, and run `pnpm install --frozen-lockfile` from the repository root. |
| API or workers cannot reach PostgreSQL | Confirm Compose's `postgres` service is healthy and the URL hostname matches the caller (Compose uses `postgres`; host-run processes usually need `127.0.0.1` and a published port). |
| Bot refuses a guild or command | Check the configured test/main guild allowlist, registered identity, bot permissions, and command-specific authorization. |
| AI/TTS reports unavailable | Verify URL, model identifier, required key, deadline, and provider health. The fallback requires complete configuration of its own. |
| Deployment stops before migration | Check image digests, disk usage, the selected verified backup's age/hash, database readiness, and migration credentials in the runbook. |
| Backup timer exists but recovery is unproven | Run restore drills with actual artifacts and record timings; timer installation alone is not recovery evidence. |

## ✧ Contributing

Keep behavior changes, tests, and documentation together. Preserve idempotency for retried money/inventory operations, check authorization on the server, and make timeouts and resource limits explicit. Update the phase acceptance record when new evidence is produced. Never commit `.env`, credentials, or generated user data.

## License and support

No license file is currently published. Until one is added, reuse and redistribution are not granted. For project questions, open an issue with a concise reproduction and sanitized logs; never include tokens, payment credentials, private member data, or unredacted environment files.
