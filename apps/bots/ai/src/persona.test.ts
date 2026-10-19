import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prepareCyrenePersonaPrompt } from "./persona.js";

const memory = [
  "# Cyrene chat persona\nDefault language: English.",
  "## 1. CORE SYSTEM DIRECTIVE\nStay in character and respond to what the user says.",
  "## 2. CHARACTER AT A GLANCE\nWarm, playful, attentive, and hopeful.",
  "## 3. IDENTITY AND NAMES\nKeep the names accurate.",
  "## 4. CANON BACKGROUND — SPOILER-AWARE MEMORY\nAvoid unprompted spoilers.",
  "## 5. PERSONALITY IN CONVERSATION\nListen before offering advice.",
  "## 6. VOICE AND PROSE STYLE FOR CHAT\nUse natural spoken dialogue.",
  "## 7. RELATIONSHIP FRAMEWORK\nDo not assume romance or pressure the user.",
  "## 8. RECURRING INTERESTS AND CONVERSATION HOOKS\nUse flowers or stories when they fit.",
  "## 9. HOW TO HANDLE COMMON USER INTENTS\nGive grounded help when asked.",
  "## 10. ROLE-PLAY BOUNDARIES AND CONTINUITY\nDo not claim access to private life.",
  "## 11. ORIGINAL SAMPLE RESPONSES — TONE REFERENCES\nDo not send sample text.",
  "## 12. INTERNAL QUALITY CHECK BEFORE EACH REPLY\nInternal notes.",
  "## 13. CANON REFERENCE LINKS\nhttps://example.invalid/reference",
].join("\n\n");

describe("Cyrene persona prompt", () => {
  it("keeps behavioral sections but excludes sample answers and reference links", () => {
    const prompt = prepareCyrenePersonaPrompt(memory);
    assert.match(prompt, /Stay in character/);
    assert.match(prompt, /Keep the names accurate/);
    assert.match(prompt, /Avoid unprompted spoilers/);
    assert.match(prompt, /Do not assume romance/);
    assert.doesNotMatch(prompt, /Do not send sample text|example\.invalid/);
    assert.ok(Buffer.byteLength(prompt, "utf8") <= 24 * 1024);
  });

  it("fails closed when a required persona section is missing or the prompt is oversized", () => {
    assert.throws(() => prepareCyrenePersonaPrompt(memory.replace("## 10. ROLE-PLAY BOUNDARIES AND CONTINUITY", "## 14. Renumbered")));
    assert.throws(() => prepareCyrenePersonaPrompt(memory.replace("Stay in character", "Stay in character " + "x".repeat(25 * 1024))));
  });
});
