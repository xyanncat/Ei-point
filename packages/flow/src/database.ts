/** A transaction always uses one checked-out connection, never Pool.query(BEGIN). */
export interface SqlResult { rows: Record<string, any>[]; rowCount: number | null }
export interface SqlClient { query(sql: string, values?: any[]): Promise<SqlResult>; release(): void }
export interface SqlPool { connect(): Promise<SqlClient>; query(sql: string, values?: any[]): Promise<SqlResult> }

export async function transaction<T>(pool: SqlPool, run: (db: SqlClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='5s'");
    await db.query("SET LOCAL lock_timeout='3s'");
    const value = await run(db);
    await db.query('COMMIT');
    return value;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

/** Small private fleet: serialize short mutations per guild, preventing lock-order deadlocks. */
export async function lockApprovedGuild(db: SqlClient, guildId: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`community:${guildId}`]);
  const result = await db.query('SELECT approved FROM access.guilds WHERE guild_id=$1 FOR SHARE', [guildId]);
  if (result.rows[0]?.approved !== true) throw new Error('guild-not-approved');
}

export async function communityEvent(db: SqlClient, guildId: string, key: string, payload: unknown): Promise<void> {
  await db.query(`INSERT INTO ops.outbox(aggregate,aggregate_id,type,payload,correlation_id)
    VALUES ('community',$1,'community.message',$2,$3) ON CONFLICT DO NOTHING`, [guildId, JSON.stringify(payload), key]);
}
