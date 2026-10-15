import {assertOptionalAssetWritesAllowed} from "./lib/resource-guard.mjs";
// Explicit operator import. Never runs automatically during website builds.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const assets=JSON.parse(await readFile(fileURLToPath(new URL('../apps/dashboard/lib/project-assets.json',import.meta.url)),'utf8'));
if(!process.argv.includes('--apply')){console.log(`Dry run: ${assets.services.length} catalog rows and ${assets.cards.length} card definitions. Validate with build-project-assets.mjs first. --apply and DATABASE_URL are required to write.`);process.exit(0);}
await assertOptionalAssetWritesAllowed(fileURLToPath(new URL('../apps/dashboard/public',import.meta.url)));
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
await client.connect();
try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='15s'");for(const s of assets.services){if(!Number.isSafeInteger(s.price_minor)||s.price_minor<=0||s.currency!=='INR')throw new Error('Invalid manifest price');await client.query('INSERT INTO commerce.catalog(sku,name,price_minor,currency,active) VALUES($1,$2,$3,$4,true) ON CONFLICT(sku) DO NOTHING',[s.sku,s.name,s.price_minor,s.currency]);}for(const c of assets.cards){await client.query('INSERT INTO games.card_definitions(card_id,name,rarity,artwork_ref,checksum) VALUES($1,$2,$3,$4,$5) ON CONFLICT(card_id) DO NOTHING',[c.card_id,c.name,c.rarity,c.artwork_ref,c.checksum]);}await client.query('COMMIT');console.log('Import complete. Existing catalog prices and card definitions were preserved. No orders, instances or balances were created.');}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
