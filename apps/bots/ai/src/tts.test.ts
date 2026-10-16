import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import * as ttsModule from "@ei-point/module-tts";
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

describe("Cyrene /tts and /leave session contract", () => {
  it("/leave stops the session and confirms", async () => {
    let stopped = false;
    const replies: string[] = [];
    const handled = await respondToTtsCommand(
      "leave",
      makeContext({
        stopPlayback: async () => {
          stopped = true;
        },
        reply: async (text) => {
          replies.push(text);
        },
      }),
      pool,
    );
    assert.equal(handled, true);
    assert.equal(stopped, true);
    assert.match(replies[0]!, /left the voice channel/i);
  });

  it("/tts refuses to start outside a voice channel without joining", async () => {
    let started = false;
    const replies: string[] = [];
    await respondToTtsCommand(
      "tts",
      makeContext({
        inVoiceChannel: false,
        startTts: async () => {
          started = true;
          return { ok: true };
        },
        reply: async (text) => {
          replies.push(text);
        },
      }),
      pool,
    );
    assert.equal(started, false);
    assert.match(replies[0]!, /join a voice channel/i);
  });

  it("/tts reports joined, already-active, no-humans and failure honestly", async () => {
    const cases: Array<[{ ok: true } | { ok: false; reason: string }, RegExp]> = [
      [{ ok: true }, /joined/i],
      [{ ok: false, reason: "already-active-elsewhere" }, /already reading/i],
      [{ ok: false, reason: "no-humans" }, /no members/i],
      [{ ok: false, reason: "voice-full" }, /could not start/i],
    ];
    for (const [result, pattern] of cases) {
      const replies: string[] = [];
      await respondToTtsCommand(
        "tts",
        makeContext({
          inVoiceChannel: true,
          startTts: async () => result,
          reply: async (text) => {
            replies.push(text);
          },
        }),
        pool,
      );
      assert.match(replies[0]!, pattern);
    }
  });
});

describe("Cyrene /speak input contract", () => {
  it("refuses empty, over-limit and secret input before synthesis", async () => {
    const cases: Array<[string, RegExp]> = [
      ["", /give me text to speak/i],
      ["a".repeat(600), /too long/i],
      ["token mfa.abcdefghij1234567890", /refused for safety/i],
    ];
    for (const [text, pattern] of cases) {
      const replies: string[] = [];
      const handled = await respondToTtsCommand(
        "speak",
        makeContext({
          text,
          reply: async (value) => {
            replies.push(value);
          },
        }),
        pool,
      );
      assert.equal(handled, true);
      assert.match(replies[0]!, pattern);
    }
  });

  it("reads eligible text only: no transcription surface exists", () => {
    const surface = Object.keys(ttsModule);
    assert.ok(
      !surface.some((key) => /transcri|whisper|speech_?to_?text|stt/i.test(key)),
      `unexpected transcription surface: ${surface.join(", ")}`,
    );
  });
});
