import test from "node:test";
import assert from "node:assert/strict";
import { EmbedBuilder } from "discord.js";
import { commonCommandDefinitions, createEiEmbed, isCommonCommand, toEiEmbedPayload, withEiEmbedReplies } from "./index.js";

test("common command list contains the three shared commands", () => {
  assert.deepEqual(commonCommandDefinitions().map((command) => command.name), ["botinfo", "ping", "about"]);
  assert.equal(isCommonCommand("about"), true);
  assert.equal(isCommonCommand("ask"), false);
});

test("branded interaction replies preserve content alongside an existing embed", async () => {
  let payload: Record<string, unknown> | undefined;
  const interaction = withEiEmbedReplies({ reply: async (value: unknown) => { payload = value as Record<string, unknown>; } });
  await interaction.reply({ content: "Preview is ready.", embeds: [new EmbedBuilder().setTitle("Custom").setDescription("Custom body")] });
  const embeds = payload?.embeds as Array<{ description?: string; image?: { url: string } }>;
  assert.equal(embeds[0]?.description, "Custom body");
  assert.equal(embeds[0]?.image?.url, process.env.EI_POINT_EMBED_IMAGE_URL ?? "https://raw.githubusercontent.com/xyanncat/Ei-point/main/docs/assets/ei-point-pulse.gif");
  assert.equal(embeds[1]?.description, "Preview is ready.");
});

test("Ei Point embeds always include the configured brand image", () => {
  const previous = process.env.EI_POINT_EMBED_IMAGE_URL;
  process.env.EI_POINT_EMBED_IMAGE_URL = "https://example.test/ei-point.png";
  try {
    assert.equal(createEiEmbed({ title: "Test", description: "Body" }).toJSON().image?.url, "https://example.test/ei-point.png");
    assert.equal(toEiEmbedPayload("Reply").embeds[0]?.toJSON().image?.url, "https://example.test/ei-point.png");
  } finally {
    if (previous === undefined) delete process.env.EI_POINT_EMBED_IMAGE_URL;
    else process.env.EI_POINT_EMBED_IMAGE_URL = previous;
  }
});

test("empty branded replies use a visible non-whitespace description", () => {
  assert.equal(toEiEmbedPayload("").embeds[0]?.toJSON().description, "No additional details.");
});
