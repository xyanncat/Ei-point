// CSRF protection (§6): per-session token, required on all mutating routes.
// Signed header token is bound to the HttpOnly session cookie.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function issueCsrfToken(sessionToken: string, secret: string): string {
  const nonce = randomBytes(16).toString("base64url");
  const mac = createHmac("sha256", secret)
    .update(`${sessionToken}.${nonce}`)
    .digest("base64url");
  return `${nonce}.${mac}`;
}

export function verifyCsrfToken(
  csrfToken: string,
  sessionToken: string,
  secret: string,
): boolean {
  const [nonce, mac, extra] = csrfToken.split(".");
  if (
    !secret ||
    nonce == null ||
    mac == null ||
    extra !== undefined ||
    !/^[\w-]{22}$/.test(nonce) ||
    !/^[\w-]{43}$/.test(mac)
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${sessionToken}.${nonce}`)
    .digest();
  const actual = Buffer.from(mac, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
