# Kafka design system

One visual language for every Ei point surface: the public website, My account,
the staff workspace and System administration. Established from the owner's
approved tokens (docs/kafka-redesign.md §Design tokens); this document is the
reference for what exists, where it lives, and what was verified.

## 1. Visual language

Near-black canvas and dark plum surfaces · wine for primary actions, orchid for
attention and links, gold strictly as ornament · warm light text (never pure
white) · an elegant system serif for page titles, the loaded UI faces for forms
and records · subtle silk-thread hairlines in headers — never character art
behind forms or tables, and status colors never reuse the purple register.

## 2. Tokens — single source of truth

**Canonical file:** `apps/dashboard/tokens.css` (`--k-*` custom properties on
`:root`, loaded first through `app/globals.css`).

| Role | Token | Value |
|---|---|---|
| Canvas | `--k-bg` / `--k-bg-deep` | `#100d13` / `#0e0a0f` |
| Panels | `--k-surface` | `#1b141f` |
| Raised (menus, drawers, selection) | `--k-raised` | `#261a29` |
| Text | `--k-text` / `--k-dim` | `#f3e9e8` / `#bbaab8` |
| Lines | `--k-line` / `--k-line-soft` | `#3a2a3c` / `#2b1f2f` |
| Actions | `--k-wine` / `--k-wine-deep` | `#7d2856` / `#5d1d40` |
| Attention / links | `--k-orchid` | `#cf8aaf` |
| Ornament | `--k-gold` | `#c7ab7a` |
| Status | `--k-ok` / `--k-warn` / `--k-bad` | `#6fd39a` / `#e4b45c` / `#ff8f8f` |
| Type | `--k-font-ui` · `--k-font-display` · `--k-text-s/m/body` · `--k-leading(-tight)` | Outfit Variable (UI) · system serif (display) |
| Spacing | `--k-space-1…6` | 0.3 → 2.4 rem |
| Corners / elevation | `--k-radius-s/m/l` · `--k-shadow-overlay` | 7/10/14 px |
| Focus | `--k-focus` | 2 px orchid |
| Motion | `--k-dur-fast` · `--k-dur-base` · `--k-ease` | 160/260 ms, cubic-bezier(0.2, 0.8, 0.2, 1) |

**Consumers map, never copy:**
- `app/theme.css` — legacy public names (`--bg`, `--surface`, `--accent`, …) → `var(--k-*)`
- `components/staff/staff.css` — workspace names (`--sf-*`) → `var(--k-*)`, plus
  `font-family: var(--k-font-ui)` and body size/leading from tokens

Rule for new work: no raw hex in components — add or reuse a token.

## 3. Components (staff/account set — `components/staff/`)

| Component | Location | States |
|---|---|---|
| Page header (title, eyebrow, explain, one action) | `ui.tsx` `PageHeader` | — |
| Panels, empty/unavailable states | `ui.tsx` `Panel` / `Empty` | empty, “Not connected yet” |
| Buttons | `staff.css` `.sf-primary` `.sf-ghost` `.sf-icon-btn` | hover, focus-visible, active, disabled, loading (text swap) |
| Fields / grouped forms | `.sf-field`, `.sf-check`, checkbox | focus, disabled |
| Local tabs | `section-tabs.tsx`, `.sf-tabs` | `aria-current`, hover, focus-visible |
| Status badges | `ui.tsx` `HealthBadge[data-health]` | ok / degraded / down / unknown / stale |
| Tables + keys | `.sf-table` (+ 640 px stacked rows), `.sf-kv`, `.sf-list`, `.sf-attention` | hover row |
| Drawers | `ui.tsx` `Drawer` (dialog role, Esc, focus restore) | slide-in, scrim |
| Inline messages | `.sf-note` `.sf-error` `.sf-ok-note` `.sf-checkmark` | info / error / success |
| Save/discard | `.sf-savebar` | appears when dirty |
| Loading | `.sf-loading`, `.sf-skeleton` | shimmer, reduced-motion aware |
| Dialogs (public) | native `<dialog>` in `checkout.tsx` | modal open/close |

**Deliberately not built:** toasts (inline notices are the pattern) and
pagination (record lists are short; the table pattern is ready — add a
pager when a list actually needs one, not before).

## 4. Four page patterns (representative pages)

1. **Overview** — `/dashboard`: hero (approved, untouched) → Needs attention →
   compact bot health → shortcuts → recent activity.
2. **Record list** — `/dashboard/commerce/payments`: header → status filter →
   table → drawer inspect → settle/reject.
3. **Settings form** — `/dashboard/moderation/protection`: header → module
   selector → grouped fields → save/discard bar → version/history.
4. **Composer** — `/dashboard/community/announcements`: header → editor left /
   live preview right → queue action → delivery history.

All four use the same header, panel, note, field and button primitives from
`components/staff/` — no page-specific layout system.

## 5. Verification (2026-10-19)

- **Contrast (computed, WCAG 2.1):** 16/16 pairs pass — body text ≥13.9:1,
  secondary text ≥7.5:1, orchid links ≥6.7:1, button text on wine ≥7.6:1,
  status colors ≥8.2:1, focus ring ≥6.2:1. Script output archived in the
  session log.
- **Keyboard:** 24/24 Tab stops across the four representative pages show the
  visible orchid focus outline.
- **Responsive:** 0 px horizontal overflow on public home, overview and record
  list at 390 px; tables stack under 640 px.
- **Suites:** typecheck clean · production build clean · browser suite 18/18
  green (public pages, checkout, staff flows, permission gates, hero tests).
- Screenshots before/after: `C:\Users\DELL\.vps\design-system-shots\`.

## 6. Remaining inconsistencies (honest list)

- `public-kafka.css` still contains many literal colors that predate the token
  layer; the variables it does use are now canonical. Migrating every literal
  is a follow-up, not done blindly.
- Public body type stays on the existing Segoe UI/Nunito stack (approved look);
  the staff/account areas now render in the loaded Outfit Variable, which was
  imported but unused before this pass.
- `components/kafka3d/preview.css` (development-only page) keeps its local
  `--kp-*` variables.
- Public `.ei-action` and staff `.sf-primary` are visually consistent but
  remain separate classes; merging would churn approved public CSS.
