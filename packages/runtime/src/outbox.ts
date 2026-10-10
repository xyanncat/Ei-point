// Outbox: mutate + publish atomically in the same tx (§5). Workers relay unpublished rows.
export const ENQUEUE_JOB_SQL = `
  INSERT INTO ops.jobs (kind, payload, idempotency_key, max_attempts)
  VALUES ($1, $2, $3, COALESCE($4, 5))
  ON CONFLICT (idempotency_key) DO NOTHING`;

export const PUBLISH_OUTBOX_SQL = `
  INSERT INTO ops.outbox (aggregate, aggregate_id, type, payload, correlation_id)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (aggregate, aggregate_id, type, correlation_id) DO NOTHING`;
