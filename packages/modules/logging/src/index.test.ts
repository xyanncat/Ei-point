import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLogEvent, isLogStream, redactSecrets } from "./index.js";

describe("logging", () => {
  it("accepts only known streams", () => {
    assert.equal(isLogStream("message"), true);
    assert.equal(isLogStream("audit"), false);
  });

  it("redacts credentials in free text", () => {
    const dirty = "token mfa.abcdef1234567890 and key AKIAIOSFODNN7EXAMPLE here";
    const clean = redactSecrets(dirty);
    assert.ok(!clean.includes("mfa.abcdef1234567890"));
    assert.ok(!clean.includes("AKIAIOSFODNN7EXAMPLE"));
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
