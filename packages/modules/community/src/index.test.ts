import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addXp, buildEmbed, levelForXp, renderWelcome } from "./index.js";

describe("welcomes", () => {
  it("substitutes known tokens, keeps unknown ones", () => {
    const out = renderWelcome("Hi {user}, welcome to {guild}! #{count} {mystery}", {
      user: "@ann",
      guild: "Paradise",
      count: 42,
    });
    assert.equal(out, "Hi @ann, welcome to Paradise! #42 {mystery}");
  });
});

describe("embeds", () => {
  it("rejects combined embed length and invalid color", () => {
    assert.equal(buildEmbed({ title: 't'.repeat(256), description: 'd'.repeat(4096), fields: [{ name: 'n', value: 'v'.repeat(1024) }, { name: 'n', value: 'v'.repeat(1024) }] }), null);
    assert.equal(buildEmbed({ title: 'a', description: 'b', color: -1 }), null);
  });
  it("accepts valid embeds", () => {
    const e = buildEmbed({ title: "News", description: "hi", fields: [{ name: "a", value: "b" }] });
    assert.equal(e?.title, "News");
  });

  it("rejects over-limit content", () => {
    assert.equal(buildEmbed({ title: "", description: "x" }), null);
    assert.equal(buildEmbed({ title: "t".repeat(257), description: "x" }), null);
    assert.equal(buildEmbed({ title: "t", description: "x".repeat(4097) }), null);
    assert.equal(
      buildEmbed({ title: "t", description: "x", fields: Array.from({ length: 26 }, () => ({ name: "n", value: "v" })) }),
      null,
    );
  });
});

describe("xp curve", () => {
  it("levels at triangular thresholds", () => {
    assert.equal(levelForXp(0), 0);
    assert.equal(levelForXp(99), 0);
    assert.equal(levelForXp(100), 1); // 50*1*2
    assert.equal(levelForXp(299), 1);
    assert.equal(levelForXp(300), 2); // 50*2*3
    assert.equal(levelForXp(-10), 0);
  });

  it("reports level-ups and clamps negatives", () => {
    assert.equal(addXp(90, 20).leveledUp, true);
    assert.equal(addXp(90, 5).leveledUp, false);
    assert.deepEqual([addXp(50, -100).xp, addXp(50, -100).level], [0, 0]);
  });
});
