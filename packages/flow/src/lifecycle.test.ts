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
      failureReply: (category) => category === "auth" ? "This server is not approved for Ei Point." : "operation failed",
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
      failureReply: () => "operation failed",
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
      failureReply: (category) => category === "timeout" ? "Request timed out; outcome unconfirmed." : "operation failed",
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

// A callback may ignore cancellation; the lifecycle must still finish and never send a late result.
it("bounds non-cooperative work and reports an uncertain outcome", async () => {
  const replies: string[] = [];
  let finish!: (value: string) => void;
  const task = handleInteraction({ botKey: "test", guildId: "1", allowlist: ["1"],
    defer: async () => {}, run: async () => new Promise<string>(resolve => { finish = resolve; }),
    reply: async text => { replies.push(text); }, failureReply: category => category === "timeout" ? "Request timed out; outcome unconfirmed." : "operation failed", onTelemetry: () => {}, deadlineMs: 5 });
  await Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error("deadline not enforced")), 100))]);
  assert.match(replies[0]!, /timed out/i);
  assert.doesNotMatch(replies[0]!, /safe to retry|no duplicate|nothing was applied/i);
  finish("late success");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(replies.length, 1);
});
it("does not claim rollback when work throws after a side effect", async () => {
  let reply = "";
  await handleInteraction({ botKey: "test", guildId: "1", allowlist: ["1"], defer: async () => {},
    run: async () => { throw new Error("database failed after effect"); },
    reply: async text => { reply = text; }, failureReply: () => "Operation failed; outcome unconfirmed.", onTelemetry: () => {} });
  assert.doesNotMatch(reply, /nothing was applied|failed safely/i);
});

it("acknowledges, authorizes, then runs with exactly one rich reply", async () => {
  const events: string[] = [];
  await handleInteraction({ botKey: "test", guildId: "1", allowlist: ["1"],
    defer: async () => { events.push("defer"); },
    authorize: async () => { events.push("authorize"); return undefined; },
    run: async () => { events.push("run"); return { content: "done", embeds: ["preserved"] }; },
    reply: async response => { events.push("reply"); assert.deepEqual(response, { content: "done", embeds: ["preserved"] }); },
    failureReply: () => ({ content: "failed" }), onTelemetry: () => {},
  });
  assert.deepEqual(events, ["defer", "authorize", "run", "reply"]);
});

it("denies after acknowledgement before mutation and survives telemetry failure", async () => {
  let mutation = false;
  let reply = "";
  await handleInteraction({ botKey: "commerce", guildId: "1", allowlist: ["1"],
    defer: async () => {},
    authorize: async () => "server paused",
    run: async () => { mutation = true; return "mutated"; },
    reply: async message => { reply = message; },
    failureReply: () => "failed", onTelemetry: () => { throw new Error("telemetry unavailable"); },
  });
  assert.equal(mutation, false);
  assert.equal(reply, "server paused");
});

it("bounds a non-cooperative authorizer and never starts command work", async () => {
  let finish!: () => void;
  let mutation = false;
  let reply = "";
  await handleInteraction({ botKey: "test", guildId: "1", allowlist: ["1"],
    defer: async () => {},
    authorize: async () => new Promise<string | undefined>(resolve => { finish = () => resolve(undefined); }),
    run: async () => { mutation = true; return "mutated"; },
    reply: async message => { reply = message; },
    failureReply: category => category === "timeout" ? "timed out; outcome unconfirmed" : "failed",
    onTelemetry: () => {}, deadlineMs: 5,
  });
  assert.equal(mutation, false);
  assert.match(reply, /timed out/i);
  finish();
});
