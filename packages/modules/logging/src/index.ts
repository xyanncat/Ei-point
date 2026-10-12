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
    .replace(/[A-Za-z0-9_-]{23,28}\.[\w-]{6,7}\.[\w-]{27,38}/g, "[redacted]")
    .replace(/xox[bap]-[\w-]+/g, "[redacted]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[redacted]")
    .replace(/ghp_[A-Za-z0-9]{36}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{30,}/g, "[redacted]")
    .replace(/[Bb]earer\s+[A-Za-z0-9_\-\.]{20,}/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/sk_(?:live|test)_[0-9a-zA-Z]{24,}/g, "[redacted]")
    .replace(/https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/gi, "[redacted-webhook]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]");
}

export function sanitizeDeep(val: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof val === "string") return redactSecrets(val);
  if (Array.isArray(val)) {
    if (seen.has(val)) return "[circular]";
    seen.add(val);
    const out = val.map((item) => sanitizeDeep(item, seen));
    seen.delete(val);
    return out;
  }
  if (val !== null && typeof val === "object") {
    if (seen.has(val as object)) return "[circular]";
    seen.add(val as object);
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      res[k] = sanitizeDeep(v, seen);
    }
    seen.delete(val as object);
    return res;
  }
  return val;
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
    detail[k] = sanitizeDeep(v);
  }
  return {
    aggregate: `log:${event.stream}`,
    aggregateId: event.guildId,
    type: event.type,
    payload: { actorId: event.actorId, ...detail },
    correlationId: event.correlationId,
  };
}
