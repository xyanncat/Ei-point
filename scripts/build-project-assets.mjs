import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  realpath,
  stat,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const publicDir = resolve(root, "apps/dashboard/public");
const services = [],
  cards = [],
  ids = new Set();
for (const [folder, file, target] of [
  ["services", "service.json", services],
  ["Cards", "card.json", cards],
]) {
  const base = resolve(root, "project assets", folder);
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(base, entry.name);
    const resolved = await realpath(directory);
    if (relative(base, resolved).startsWith(".."))
      throw new Error("Asset directories must remain inside their drop zone.");
    const value = JSON.parse(await readFile(resolve(directory, file), "utf8"));
    const id = folder === "services" ? value.sku : value.card_id;
    if (
      typeof id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,100}$/.test(id) ||
      ids.has(`${folder}:${id}`)
    )
      throw new Error(`Invalid or duplicate ID in ${entry.name}`);
    ids.add(`${folder}:${id}`);
    if (typeof value.name !== "string" || !value.name.trim())
      throw new Error(`Missing name in ${entry.name}`);
    if (folder === "services") {
      if (
        !Number.isSafeInteger(value.price_minor) ||
        value.price_minor <= 0 ||
        value.currency !== "INR" ||
        typeof value.description !== "string" ||
        value.slug !== entry.name
      )
        throw new Error(`Invalid service definition in ${entry.name}`);
    } else {
      if (
        !["common", "rare", "epic", "legendary", "mythic"].includes(
          value.rarity,
        ) ||
        typeof value.artwork_file !== "string"
      )
        throw new Error(`Invalid card definition in ${entry.name}`);
      const artwork = resolve(directory, value.artwork_file);
      const rel = relative(directory, await realpath(artwork));
      if (
        rel.startsWith("..") ||
        isAbsolute(rel) ||
        ![".png", ".jpg", ".jpeg", ".webp", ".avif"].includes(
          extname(artwork).toLowerCase(),
        )
      )
        throw new Error("Invalid artwork path/type");
      if ((await stat(artwork)).size > 500_000)
        throw new Error(`Card artwork exceeds 500 KB: ${id}`);
      const bytes = await readFile(artwork);
      value.checksum = createHash("sha256").update(bytes).digest("hex");
      value.artwork_ref = `/art/cards/${id}${extname(artwork).toLowerCase()}`;
      await mkdir(resolve(publicDir, "art/cards"), { recursive: true });
      await copyFile(artwork, resolve(publicDir, `.${value.artwork_ref}`));
    }
    target.push(value);
  }
}
services.sort(
  (a, b) => a.game.localeCompare(b.game) || a.name.localeCompare(b.name),
);
cards.sort((a, b) => a.card_id.localeCompare(b.card_id));
await mkdir(resolve(root, "apps/dashboard/lib"), { recursive: true });
await writeFile(
  resolve(root, "apps/dashboard/lib/project-assets.json"),
  JSON.stringify({ services, cards }, null, 2) + "\n",
);
console.log(
  `Validated ${services.length} services and ${cards.length} cards. No database mutations.`,
);
