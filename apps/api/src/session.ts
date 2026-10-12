// Server-side sessions (§6): HMAC-signed cookie payload. No dependency on fastify —
// route wiring lives in index.ts; this module is pure and unit-testable.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionClaims } from "@ei-point/contracts";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signSession(claims: Omit<SessionClaims, "expiresAt">, secret: string, ttlMs = SESSION_TTL_MS): string {
  const payload = b64url(JSON.stringify({ ...claims, expiresAt: Date.now() + ttlMs }));
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string): SessionClaims | null {
  if (!secret || token.length > 2048 || token.split('.').length !== 2) return null;
  const [payload, sig] = token.split(".");
  if (payload == null || sig == null) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }
  if (claims == null || typeof claims !== 'object' || typeof claims.discordUserId !== "string" || typeof claims.expiresAt !== "number") return null;
  if (!Number.isFinite(claims.expiresAt) || claims.expiresAt <= Date.now()) return null;
  return claims;
}
