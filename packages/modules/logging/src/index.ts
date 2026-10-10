// Logging module: guild event capture for message/member/channel/role/voice streams
// (§2 moderation bot). Builds outbox rows; PII-safe by default (token redaction).

export const LOG_STREAMS = ["message", "member", "channel", "role", "voice"] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

export function isLogStream(stream: string): stream is LogStream {
  return (LOG_STREAMS as readonly string[]).includes(stream);
}

// Redact anything that looks like a credential before persisting log detail.
export function redactSecrets(text: string): string {
  return text
    .replace(/mfa\.[\w-]{10,}/g, "[redacted]")
    .replace(/MT[A-Za-z0-9-_]{20,}\.[\w-]+\.[\w-]+/g, "[redacted]")
    .replace(/xox[bap]-[\w-]+/g, "[redacted]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[redacted]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]");
}

export interface LogEvent {
  guildId: string;
  stream: LogStream;
  type: string;
  actorId: string | null;
  detail: Record<string, unknown>;
  correlationId: string;
}

export function buildLogEvent(event: LogEvent): {
  aggregate: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  correlationId: string;
} {
  const detail: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event.detail)) {
    detail[k] = typeof v === "string" ? redactSecrets(v) : v;
  }
  return {
    aggregate: `log:${event.stream}`,
    aggregateId: event.guildId,
    type: event.type,
    payload: { actorId: event.actorId, ...detail },
    correlationId: event.correlationId,
  };
}
