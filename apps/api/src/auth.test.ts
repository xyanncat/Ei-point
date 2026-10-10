import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession } from "./session.js";
import { issueCsrfToken, verifyCsrfToken } from "./csrf.js";
import { buildAuthorizeUrl, exchangeCode, verifyOAuthState } from "./oauth.js";

const SECRET = "test-secret-32chars-minimum-xxxx";

describe("session", () => {
  it("round-trips valid claims", () => {
    const token = signSession({ discordUserId: "123" }, SECRET);
    const claims = verifySession(token, SECRET);
    assert.equal(claims?.discordUserId, "123");
  });

  it("rejects tampered payloads", () => {
    const token = signSession({ discordUserId: "123" }, SECRET);
    const [payload, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ discordUserId: "999", expiresAt: Date.now() + 9999 })).toString("base64url")}.${sig}`;
    assert.equal(payload == null, false);
    assert.equal(verifySession(forged, SECRET), null);
  });

  it("rejects expired sessions", () => {
    const token = signSession({ discordUserId: "123" }, SECRET, -1000);
    assert.equal(verifySession(token, SECRET), null);
  });

  it("rejects wrong secret", () => {
    const token = signSession({ discordUserId: "123" }, SECRET);
    assert.equal(verifySession(token, "other-secret-32chars-minimum-yyyy"), null);
  });
});

describe("csrf", () => {
  it("binds token to session", () => {
    const session = signSession({ discordUserId: "123" }, SECRET);
    const token = issueCsrfToken(session, SECRET);
    assert.equal(verifyCsrfToken(token, session, SECRET), true);
    assert.equal(verifyCsrfToken(token, "other-session", SECRET), false);
  });
});

describe("oauth", () => {
  const cfg = {
    clientId: "cid",
    clientSecret: "csecret",
    redirectUrl: "http://localhost:3000/api/auth/callback",
    stateSecret: SECRET,
  };

  it("builds an authorize URL with verifiable state", () => {
    const { url, state } = buildAuthorizeUrl(cfg);
    assert.ok(url.startsWith("https://discord.com/oauth2/authorize?"));
    assert.ok(url.includes("client_id=cid"));
    assert.equal(verifyOAuthState(state, SECRET), true);
    assert.equal(verifyOAuthState("bad.state", SECRET), false);
  });

  it("exchanges codes via injected fetch (no network)", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 604800 }), {
        status: 200,
      })) as typeof fetch;
    const res = await exchangeCode(cfg, "code123", fetchFn);
    assert.equal(res.accessToken, "tok");
  });

  it("rejects failed exchanges clearly", async () => {
    const fetchFn = (async () => new Response("denied", { status: 403 })) as typeof fetch;
    await assert.rejects(() => exchangeCode(cfg, "bad", fetchFn), /oauth-exchange-failed:403/);
  });
});
