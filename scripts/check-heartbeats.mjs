import pg from 'pg';
const c=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
const keys=(process.argv[2]??'').split(',').filter(Boolean);
if(keys.some(key=>!/^[-a-z0-9]+$/.test(key)))throw Error('Invalid heartbeat roster');
try{
 await c.connect();
 const r=await c.query("SELECT wanted.bot_key FROM unnest($1::text[]) wanted(bot_key) WHERE NOT EXISTS(SELECT 1 FROM config.bots b JOIN ops.service_status s ON s.service IN (b.bot_key,'bot-'||b.bot_key) WHERE b.bot_key=wanted.bot_key AND cardinality(b.guild_ids)>0 AND s.liveness='ok' AND s.gateway='ok' AND s.db_ready AND s.updated_at>now()-interval '90 seconds') UNION ALL SELECT 'workers' WHERE NOT EXISTS(SELECT 1 FROM ops.service_status WHERE service='workers' AND liveness='ok' AND db_ready AND updated_at>now()-interval '90 seconds')",[keys]);
 if(r.rows.length)throw Error('Stale/unready registered identities: '+r.rows.map(x=>x.bot_key).join(','));
}finally{await c.end();}
