import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectRaid,
  evaluateAction,
  planRestore,
  snapshotChecksum,
  trustBand,
  trustScore,
  verifySnapshot,
} from "./index.js";

describe("raid detection", () => {
  it("flags threshold joins inside the window", () => {
    const now = Date.now();
    const joins = Array.from({ length: 8 }, (_, i) => now - i * 1000);
    assert.equal(detectRaid(joins, 8, 60_000), true);
  });

  it("ignores slow trickles and small bursts", () => {
    const now = Date.now();
    const trickle = Array.from({ length: 8 }, (_, i) => now - i * 60_000);
    assert.equal(detectRaid(trickle, 8, 60_000), false);
    assert.equal(detectRaid([now, now - 1000], 8, 60_000), false);
  });
});

describe("trust scoring", () => {
  it("starts at 100 and decays with violations", () => {
    assert.equal(trustScore([]), 100);
    const now = Date.now();
    const low = trustScore([{ weight: 5, atMs: now }], now);
    assert.ok(low < 100 && low >= 0);
  });

  it("old violations decay; whitelist pins to 100", () => {
    const now = Date.now();
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
    assert.ok(trustScore([{ weight: 10, atMs: yearAgo }], now) > 95);
    assert.equal(trustScore([{ weight: 10, atMs: now }], now, true), 100);
  });

  it("bands map to the right actions", () => {
    assert.equal(trustBand(90), "trusted");
    assert.equal(trustBand(60), "watch");
    assert.equal(trustBand(30), "restrict");
    assert.equal(trustBand(5), "quarantine");
  });
});

describe("antinuke", () => {
  it("allows under limit, flags at limit, quarantines at 2x", () => {
    assert.equal(evaluateAction("ban", 1), "allow");
    assert.equal(evaluateAction("ban", 3), "flag");
    assert.equal(evaluateAction("ban", 6), "quarantine");
    assert.equal(evaluateAction("ban", 99, true), "allow");
  });
});

describe("snapshots", () => {
  it("checksum round-trips and detects tampering", () => {
    const payload = { channels: ["a", "b"], roles: ["r1"] };
    const sum = snapshotChecksum(payload);
    assert.equal(verifySnapshot(payload, sum), true);
    assert.equal(verifySnapshot({ channels: ["a"], roles: ["r1"] }, sum), false);
  });

  it("restore plan recreates only missing entries", () => {
    const snap = {
      c1: { name: "general", kind: "channel" as const },
      r1: { name: "mods", kind: "role" as const },
    };
    const steps = planRestore(snap, new Set(["c1"]));
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.targetId, "r1");
    assert.equal(steps[0]?.action, "recreate");
  });
});
