# Services — asset drop-zone (Phase 6–7 source material)

> Status: **19 original service definitions imported from Ei Paradise.zip.** Do not invent service content here;
> this folder holds reference material for the feature inventory (`docs/feature-matrix.md` Phase 1).

## Purpose

Service definitions for the public website + bot game services
(plan §6: marketing, game services, membership, referrals, payment QR, order verification).
Each service maps to a `commerce.catalog` row (server owns prices) and/or a bot module.

## Drop contract (per service)

```text
project assets/services/<service-slug>/
  service.json      { slug, name, description, price_minor, currency, sku, bot_module }
  artwork/          promo art (see size rules below)
```

- `service.json` is the source of truth for the Phase 7 catalog import. Prices in **integer minor units**.
- Artwork: web-optimized (≤ 500 KB per file, total per service ≤ 5 MB — §1 WAN bound).
  Originals stay here; the pipeline copies + checksums into the `artwork` volume.
  DB stores only `artwork_ref` + `checksum`, never inline bytes (§4).
- Add one row per service to `docs/feature-matrix.md` when dropping files.

The imported catalog preserves original INR prices and excludes the temporary INR 6 payment probe. Run `node scripts/build-project-assets.mjs` from the repository root to validate and publish definitions into the website manifest; dashboard builds run this automatically. Website publication does not mutate payment orders or database prices. See `docs/legacy-web-parity.md` for provenance and pending checkout parity.
