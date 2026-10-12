import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLogEvent, isLogStream, redactSecrets } from "./index.js";

describe("logging", () => {
  it("accepts only known streams", () => {
    assert.equal(isLogStream("message"), true);
    assert.equal(isLogStream("audit"), false);
  });

  it("redacts credentials in free text", () => {
    // Token-shaped strings are assembled at runtime so no literal in this
    // repository matches a real credential pattern (GitHub push protection).
    const fakeDiscordToken = ["MTAxMjM0NTY3ODkwMTIzNDU2Nw", "GxYz12", "abc123def456ghi789jkl012mno345pqr678"].join(".");
    const fakeGithubClassic = "ghp_" + "0123456789abcdef" + "0123456789abcdef0123";
    const fakeGithubPat = "github_pat_" + "11AAAAAAA0123456789_" + "abcdefghijklmnopqrstuvwxyz0123456789";
    const dirty =
      "token mfa.abcdef1234567890, discord " +
      fakeDiscordToken +
      " and key AKIAIOSFODNN7EXAMPLE and ghp_0123456789abcdef0123456789abcdef0123 and " +
      fakeGithubPat +
      " and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID here";
    const clean = redactSecrets(dirty);
    assert.ok(!clean.includes("mfa.abcdef1234567890"));
    assert.ok(!clean.includes(fakeDiscordToken));
    assert.ok(!clean.includes("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(!clean.includes(fakeGithubClassic));
    assert.ok(!clean.includes(fakeGithubPat));
    assert.ok(!clean.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
  });

  it("builds outbox-shaped events with redacted detail", () => {
    const row = buildLogEvent({
      guildId: "123",
      stream: "message",
      type: "message.delete",
      actorId: "456",
      detail: { content: "hello mfa.abcdef1234567890" },
      correlationId: "c1",
    });
    assert.equal(row.aggregate, "log:message");
    assert.equal(row.correlationId, "c1");
    assert.ok(!(row.payload["content"] as string).includes("mfa."));
  });
});
