import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleInteraction } from "./lifecycle.js";
import { nextBackoffMs } from "./jobs.js";
import { isGuildApproved } from "./auth.js";

describe("lifecycle", () => {
  it("rejects unapproved guilds before side effects", async () => {
    let ran = false;
    let replied = "";
    await handleInteraction({
      botKey: "security",
      guildId: "999",
      allowlist: ["123"],
      defer: async () => {},
      run: async () => {
        ran = true;
        return "ok";
      },
      reply: async (m) => {
        replied = m;
      },
      onTelemetry: () => {},
    });
    assert.equal(ran, false);
    assert.match(replied, /not approved/);
  });

  it("blocks double replies", async () => {
    const replies: string[] = [];
    await handleInteraction({
      botKey: "security",
      guildId: "123",
      allowlist: ["123"],
      defer: async () => {},
      run: async () => "done",
      reply: async (m) => {
        replies.push(m);
      },
      onTelemetry: () => {},
    });
    assert.equal(replies.length, 1);
  });

  it("times out slow work with a clear message", async () => {
    let replied = "";
    await handleInteraction({
      botKey: "ai",
      guildId: "123",
      allowlist: ["123"],
      defer: async () => {},
      run: async (signal) => {
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        return "never";
      },
      reply: async (m) => {
        replied = m;
      },
      onTelemetry: () => {},
      deadlineMs: 50,
    });
    assert.match(replied, /timed out/i);
  });
});

describe("jobs", () => {
  it("backoff grows with jitter bound", () => {
    const b0 = nextBackoffMs(0, 1000, 60000);
    const b5 = nextBackoffMs(5, 1000, 60000);
    assert.ok(b0 >= 500 && b0 <= 1000);
    assert.ok(b5 > b0);
    assert.ok(isGuildApproved("123", ["123"]));
  });
});
