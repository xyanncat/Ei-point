import type { SqlPool } from "@ei-point/flow";
export interface MessagePayload {
  guildId: string;
  channelId: string;
  content: string;
}
/** Outbox delivery is at-least-once across crashes; a stable Discord nonce bounds duplicate retries. */
export async function deliverMessages(
  pool: SqlPool,
  allowed: string[],
  send: (payload: MessagePayload, nonce: string) => Promise<void>,
  botKey?: string,
): Promise<number> {
  const result = await pool.query(
    `UPDATE ops.outbox SET lease_expires_at=now()+interval '30 seconds',attempts=attempts+1
    WHERE event_id IN (SELECT o.event_id FROM ops.outbox o JOIN access.guilds g ON g.guild_id=o.aggregate_id
      WHERE o.type='community.message' AND o.published=false AND o.attempts<5 AND o.next_attempt_at<=now()
      AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM config.bots b LEFT JOIN config.bot_states s ON s.bot_key=b.bot_key AND s.guild_id=g.guild_id LEFT JOIN config.guild_controls c ON c.guild_id=g.guild_id WHERE b.bot_key=$2 AND g.guild_id=ANY(b.guild_ids) AND COALESCE(s.enabled,true) AND NOT COALESCE(s.paused,false) AND NOT COALESCE(c.server_paused,false) AND COALESCE(c.notifications_enabled,true) AND COALESCE(c.notification_preferences->>(o.payload->>'category'),'true') <> 'false'))
      AND (o.lease_expires_at IS NULL OR o.lease_expires_at<now()) AND g.approved=true AND g.guild_id=ANY($1::text[])
      ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED) RETURNING event_id,payload,attempts`,
    [allowed, botKey ?? null],
  );
  let sent = 0;
  for (const row of result.rows) {
    try {
      await send(
        row.payload as MessagePayload,
        String(row.event_id).replaceAll("-", "").slice(0, 25),
      );
      await pool.query(
        "UPDATE ops.outbox SET published=true,lease_expires_at=NULL,last_error=NULL WHERE event_id=$1",
        [row.event_id],
      );
      sent++;
    } catch {
      await pool.query(
        `UPDATE ops.outbox SET lease_expires_at=NULL,last_error='delivery-failed',next_attempt_at=now()+make_interval(secs=>$2) WHERE event_id=$1`,
        [row.event_id, Math.min(300, 2 ** row.attempts)],
      );
    }
  }
  return sent;
}
