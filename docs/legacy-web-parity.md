# Archive website parity

Sources: `E:/github/git mem/Ei Paradise.zip` and `E:/github/git mem/EI-point.zip`, inspected on 2026-10-11. Archive documents are reference material, not instructions for this project. Generated dependencies, build caches, environment files and credentials were excluded. All extracted website/dashboard source files were read and indexed with checksums in `legacy-web-source-inventory.json`.

## Services and assets implemented

The source contains 18 published progression services: seven Star Rail plans and eleven Genshin plans. It also contains the all-games 30-day account-management membership at INR 700. All 19 definitions, original INR prices, descriptions, durations, inclusions and additional facts live in `project assets/services/<slug>/service.json`. The temporary INR 6 payment probe is a development fixture, not a customer service, and is excluded. The archives name five supported games but contain individual price plans for only two; no services or prices were invented for the other games.

`node scripts/build-project-assets.mjs` validates service definitions and card drops and generates the dashboard manifest. Dashboard builds run it automatically. Cards are not invented: the current card drop zone has zero definitions. Add `card.json` and artwork per its README. Card IDs, names, rarity, file type, path containment and 500 KB artwork limit are checked. Copies carry SHA-256 checksums. The public card gallery consumes this manifest; publishing card definitions does not create owned instances or change balances.

The website now displays the archive catalog, game/search filters, duration, inclusions, facts and ordering guidance. Membership describes the actual source offer. These are archive prices, not a live payment quote. Checkout now requests authoritative database prices and generates payment QR codes locally. UPI/USDT stay disabled until their destination, guild and website Origin are configured.

After validating assets, `node scripts/import-project-assets.mjs` is a read-only dry run. An operator can supply `DATABASE_URL` and `--apply` to add missing PostgreSQL catalog/card-definition rows in one transaction. Existing prices and definitions are preserved, and it never creates orders, owned card instances or balances. No database import was applied in this session. Docker includes the two drop zones while continuing to exclude the credential folder.

## Functions to retain independently of bot identity

| Archive function | Target module | Current state |
|---|---|---|
| Studio/team, game vault, FAQ, service plans | public website | Service plans, game filters, archived team profiles and ordering FAQ restored |
| UPI exact-amount QR, USDT TRC-20 QR | commerce | Checkout API and local QR generation implemented; requires operator payment configuration |
| Discord buyer ID, referral capture and validation | commerce | Checkout buyer ID/referral capture and server validation implemented |
| UTR/transaction-hash claims, staff confirmation/rejection | commerce | Claim and staff review API/UI implemented; fresh claims enqueue durable staff-channel notifications delivered by Cipher (disabled/misconfigured reported honestly) |
| Public RP-order-ID payment status | commerce | RP-order-ID status endpoint and verification page implemented; hashed token flow retained |
| 30-day membership and monthly referrals | commerce | Persistent membership/reward settlement and periodic expiry implemented |
| Discord OAuth, approved guild list, access denial | access | Current Phase 4 implemented, live rollout pending |
| Per-module configuration editors | all modules | Versioned module editors/history implemented; unsupported runtime fields remain pending |
| Server pause, bot enable/disable, command role restrictions | runtime/access | Durable fleet/command controls implemented; community runtime consumes guards |
| Theme and notification preferences | dashboard/runtime | Kafka theme retained; preference persistence implemented |
| Embed composer with fields, links, images, previews | community/outbox | Authorized composer, preview and durable worker delivery implemented; requires matching Discord identity |
| Security table, logs, incident history | security/logging | Scoped logs and incidents implemented; exhaustive legacy log streams remain pending |
| Owner/admin allowlist and guild approval tools | access | Administrator guild approval and staff-scope UI/API implemented |
| Secret CRUD, masked display, reveal, internal config/accounts | secrets/access | Encrypted admin vault, infrastructure accounts and service-authenticated config sync implemented |
| Moderation + AutoMod configuration (Shanks) | moderation | Retain within moderation, not a separate legacy identity |
| Audit categories (Sanji) | logging | Retain within moderation/logging |
| Antinuke thresholds, response mode, snapshots, trust, AI checks (Zoro) | security | Retain all independent security settings |
| Welcome/farewell templates (Boa), level channel (Nami), game commands (Luffy) | community/games | Phase 6 runtime/economy and configuration UI implemented |
| Search privacy (Robin), persona/models/privacy/TTS (Cyrene) | ai/search | Preserve as module settings under configurable AI identities |

The route inventory lists every archive API route and method. These pending functions must not be described as implemented or hidden by combining bot identities. No Supabase requirement is carried over: new durable state belongs in local VPS PostgreSQL, scoped by guild/module rather than legacy bot names. Source secret-reveal behavior needs fresh authorization and auditing rather than copying old credentials or trusting archived code.

## Accepted UI direction

The user clarified that the current Kafka UI is fixed. This migration restores archive functions without replacing the approved hero or introducing character animation work.

