import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { respondToTtsCommand, ttsCommandDefinitions, type TtsCommandContext } from "./tts.js";

const pool = {} as Pool;

function makeContext(overrides: Partial<TtsCommandContext>): TtsCommandContext {
  return {
    guildId: "guild",
    userId: "user",
    inVoiceChannel: false,
    reply: async () => {},
    sendAudio: async () => {},
    startTts: async () => ({ ok: true }),
    playAudio: async () => ({ ok: true }),
    stopPlayback: async () => {},
    search: async () => "answer",
    ...overrides,
  };
}

describe("Cyrene /search command", () => {
  it("registers a required bounded query for the AI answer", () => {
    const command = ttsCommandDefinitions.find((c) => c.name === "search")?.toJSON();
    assert.ok(command, "/search must be registered");
    const option = command.options?.find((o) => o.name === "query");
    assert.ok(option, "query option must be registered");
    assert.equal(option.required, true);
    assert.equal("max_length" in option ? option.max_length : undefined, 300);
  });

  it("replies with the search answer and passes the query through unchanged", async () => {
    const seen: string[] = [];
    const replies: string[] = [];
    const handled = await respondToTtsCommand(
      "search",
      makeContext({
        query: "who is Kafka?",
        reply: async (text) => {
          replies.push(text);
        },
        search: async (query) => {
          seen.push(query);
          return "Kafka is the moderation bot.";
        },
      }),
      pool,
    );
    assert.equal(handled, true);
    assert.deepEqual(seen, ["who is Kafka?"]);
    assert.deepEqual(replies, ["Kafka is the moderation bot."]);
  });

  it("asks for a question instead of calling the AI for an empty query", async () => {
    let called = false;
    const replies: string[] = [];
    const handled = await respondToTtsCommand(
      "search",
      makeContext({
        query: "   ",
        reply: async (text) => {
          replies.push(text);
        },
        search: async () => {
          called = true;
          return "should not happen";
        },
      }),
      pool,
    );
    assert.equal(handled, true);
    assert.equal(called, false);
    assert.equal(replies.length, 1);
    assert.match(replies[0]!, /question/i);
  });
});
