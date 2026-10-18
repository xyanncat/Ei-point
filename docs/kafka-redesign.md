# Kafka redesign — navigation, design system and page patterns

Owner brief (2026-10-18). Three areas share one Kafka design system:

| Area | Audience | Routes |
|---|---|---|
| Public website | Visitors / customers | `/`, `/services`, `/cards`, `/membership`, `/referrals`, `/about`, `/verify` |
| My account | Customers / members | `/account` (orders, membership, referrals, collection where supported) |
| Staff workspace | Moderators, operators, admins | `/dashboard/*` |

Verify order stays a utility link. Staff workspace is linked from the account menu and public footer.

## Staff navigation map (one permanent home per function)

| Section | Route | Contents |
|---|---|---|
| Overview | `/dashboard` | Attention items, compact health summary, shortcuts, recent activity |
| Bots | `/dashboard/bots`, `/dashboard/bots/[botKey]` | Status, assigned capabilities, bot state, command permissions, diagnostics |
| Moderation | `/dashboard/moderation` | Incidents; cases / protection rules / temporary actions as modules publish them |
| Community | `/dashboard/community` | Welcome & leave, announcements (embed composer + delivery), levels, cards & economy |
| Commerce | `/dashboard/commerce` | Orders, payment review, services, memberships, referrals |
| Activity | `/dashboard/activity` | Audit trail and job/delivery history |
| Settings | `/dashboard/settings` | Server settings, notifications, module configuration, staff access |
| System | `/dashboard/system` | Owner/admin only: guild approvals, staff scopes, secret vault, infrastructure accounts |

`Configuration`, `Fleet controls` and `Administration` are removed as destinations; their controls moved into the sections above.

Sections with distinct subpages use **local tabs** (bookmarkable URLs); the sidebar stays at the eight destinations:

| Section | Tabs |
|---|---|
| Commerce | Orders `/dashboard/commerce` · Payment review `/dashboard/commerce/payments` · Services `/dashboard/commerce/services` · Memberships & referrals `/dashboard/commerce/memberships` |
| Community | Welcome & leave `/dashboard/community` · Levels `/dashboard/community/levels` · Announcements `/dashboard/community/announcements` · Cards & economy `/dashboard/community/economy` |
| Moderation | Incidents `/dashboard/moderation` · Cases `/dashboard/moderation/cases` · Protection rules `/dashboard/moderation/protection` |
| Activity | Audit trail `/dashboard/activity` · Job history `/dashboard/activity/jobs` |
| Settings | Server `/dashboard/settings` · Notifications `/dashboard/settings/notifications` · Modules `/dashboard/settings/modules` · Staff access `/dashboard/settings/staff` |

One home per module: welcome/leveling/games live in Community, security/moderation/logging in Moderation · Protection rules, everything else in Settings · Modules. Staff access (role grants for the selected server) lives in Settings · Staff access; System keeps guild approvals, the secret vault and infrastructure accounts.

## Design tokens

| Role | Value |
|---|---|
| Page canvas | `#100D13` |
| Surface (nav, tables, forms) | `#1B141F` |
| Raised surface (menus, drawers, selection) | `#261A29` |
| Text | `#F3E9E8` |
| Secondary text | `#BBAAB8` |
| Kafka wine (primary actions) | `#7D2856` |
| Orchid accent (focus, links, active) | `#CF8AAF` |
| Muted gold (ornament) | `#C7AB7A` |

Status keeps meaningful green/amber/red, distinct from decorative accents. Serif (system stack) for page titles and editorial headings; the loaded sans faces for UI; monospace only for IDs. One spacing scale, one border treatment, one corner radius. Silk-thread hairlines and occasional geometric framing as ornament — never character art behind every table or form.

## Page patterns

1. **Overview** — header → attention → compact summaries.
2. **List + details** — filters → table → drawer (quick inspection) or detail page (payment review, cases).
3. **Settings** — grouped fields → explanations → save/discard bar.
4. **Composer** — editor left, live preview right, delivery result below.

Every page: one title, one short explanation, one clear primary action. Every page bookmarkable; server selection is preserved in the URL (`?server=`).

## Motion rules (CSS-driven, no animation library)

- Active navigation: a silk accent line transitions to the selected item.
- Page change: brief fade + small positional transition; drawer slides from the right.
- Buttons: quick color/border response, subtle press feedback.
- Successful save: restrained check + persistent confirmation.
- Decorative threads move slowly only in headers/margins.
- `prefers-reduced-motion` disables all non-essential motion; ambient motion keeps a pause control. Tables, forms and dashboard navigation stay immediate (no scroll hijacking).
- Character motion is confined to the hero/login and selected landing areas; a rigged/animated asset is required for real blinking or hair movement — a moving flat image is labeled as an animated illustration, not character animation.

## Honest states

Unconnected features are marked unavailable/planned; the demo never shows contradictory data ("Not found in demo" replaced by explicit demo-unavailable copy where fixtures do not exist). Saving in the demo preview returns a clear read-only notice.

## Redesign order (tracked)

1. ✅ Navigation map and function relocation (this change).
2. ✅ Tokens + shared staff components.
3. ✅ Staff shell: sidebar, server selector, header, breadcrumbs.
4. ✅ Overview + the four page patterns.
5. ✅ Section pages with live data where the API exists and honest states elsewhere: Bots (+per-bot detail), Moderation, Community, Commerce (+drawer), Activity, Settings, System. Depth grows as each module publishes.
6. 🚧 My account + login: login uses the approved hero composition; account links and honest states are in; order history/membership arrive with the commerce rollout.
7. 🚧 Artwork + motion polish: hero and login final; section landing art, silk-thread pass and character animation assets (rigged, not moving posters) still to come.
8. 🚧 Verification: browser suite updated to this IA (16/16 green locally, incl. drawer focus, guild-switch race, reduced motion, 390px fit). CI enforces on every push.

## Three areas (owner task 2026-10-19, part 2)

| Area | Navigation | Routes |
|---|---|---|
| Public website | Home � Services � Cards � Membership � Help (utility: Verify order, My account; staff via account menu + footer) | `/`, `/services`, `/services/[sku]`, `/cards`, `/membership`, `/help`, `/referrals`, `/about`, `/verify`, `/login` |
| My account | Overview � My orders � Membership � Referrals � Account settings | `/account`, `/account/orders`, `/account/membership`, `/account/referrals`, `/account/settings` � customer data backend does not exist yet; pages document the gap honestly |
| Staff workspace | Grouped sidebar: Workspace / Server management / Records / Preferences / Owner�admin | `/dashboard/*` with section tabs (see above), bot tabs (Overview/Configuration/Command permissions/Diagnostics) |
| System (global) | Guilds � Integrations � Secret vault � Backups | `/dashboard/system/*`; `/system/*` redirects here deliberately |

Preserved public URLs: `/referrals` and `/about` (no redirects). The ordering FAQ moved from `/about` to `/help`; `/about` keeps the studio team.
