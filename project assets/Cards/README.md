# Cards — asset drop-zone (Phase 6 source material)

> Status: **empty — awaiting asset drops.** Do not invent card content here;
> this folder holds reference material for the feature inventory (`docs/feature-matrix.md` Phase 1).

## Purpose

Trading-card catalog: definitions + artwork for packs, inventories, market and trades
(plan §2 community/games, §4 `games.*` tables).

## Drop contract (per card)

```text
project assets/Cards/<card-slug>/
  card.json         { card_id, name, rarity, set, artwork_file }
  artwork.png       card art (see size rules below)
```

- `card_id` must be stable and unique — it becomes `games.card_definitions.card_id` (PK).
- Rarity values: `common | rare | epic | legendary | mythic` (extensible per set).
- Artwork: ≤ 500 KB per file (§1 WAN bound). Checksummed on import into the `artwork`
  volume; DB stores `artwork_ref` + `checksum` only (§4).
- Economy safety (§4, §11): instances, listings and trades are created **only** inside
  Postgres transactions with idempotency keys — drops here never mutate live state.
- Add one row per card to `docs/feature-matrix.md` when dropping files.
