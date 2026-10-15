import type { Pool } from "pg";
export async function acquireVoiceLease(pool: Pool, owner: string): Promise<boolean> {
  const transaction = await pool.connect();
  try {
    await transaction.query("BEGIN");
    await transaction.query("SELECT pg_advisory_xact_lock(810208)");
    await transaction.query("DELETE FROM ai.voice_leases WHERE expires_at<=now()");
    const count = await transaction.query("SELECT count(*)::int count FROM ai.voice_leases");
    if (count.rows[0].count >= 2) { await transaction.query("ROLLBACK"); return false; }
    await transaction.query("INSERT INTO ai.voice_leases VALUES($1,now()+interval '60 seconds')", [owner]);
    await transaction.query("COMMIT");
    return true;
  } catch (error) { await transaction.query("ROLLBACK"); throw error; }
  finally { transaction.release(); }
}
