import test from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "./token-vault.js";
import { signSession, verifySession } from "./session.js";
import { createHmac } from "node:crypto";
import { buildAuthorizeUrl, verifyOAuthState } from "./oauth.js";
import { issueCsrfToken, verifyCsrfToken } from "./csrf.js";
test("OAuth and CSRF tokens reject trailing fields and malformed base64", () => {
  const secret = "test-only-secret-at-least-32-characters";
  const { state } = buildAuthorizeUrl({
    clientId: "test",
    clientSecret: "test",
    redirectUrl: "https://example.test",
    stateSecret: secret,
  });
  assert.equal(verifyOAuthState(state + "!", secret), false);
  const csrf = issueCsrfToken("session", secret);
  assert.equal(verifyCsrfToken(csrf + ".extra", "session", secret), false);
  assert.equal(verifyCsrfToken(csrf + "!", "session", secret), false);
});
test("token vault preserves token and rejects tampering or key changes", () => {
  const secret = "test-only-secret-at-least-32-characters",
    token = "private-oauth-access-token";
  const encrypted = encryptToken(token, secret);
  assert.ok(!encrypted.includes(token));
  assert.equal(decryptToken(encrypted, secret), token);
  assert.throws(() => decryptToken(encrypted, secret + "changed"));
  const parts = encrypted.split(".");
  parts[1] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => decryptToken(parts.join("."), secret));
});
test("session parser rejects malformed signed claims and trailing fields", () => {
  const secret = "test-only-secret-at-least-32-characters",
    payload = Buffer.from("null").toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  assert.equal(verifySession(`${payload}.${mac}`, secret), null);
  assert.equal(
    verifySession(
      signSession({ discordUserId: "123" }, secret) + ".extra",
      secret,
    ),
    null,
  );
});
