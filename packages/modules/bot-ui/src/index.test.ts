import test from "node:test";
import assert from "node:assert/strict";
import { EmbedBuilder } from "discord.js";
import { commonCommandDefinitions, createEiEmbed, isCommonCommand, resolveEmbedImage, respondToCommonCommand, toEiEmbedPayload, withEiEmbedReplies } from "./index.js";

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

test("per-identity embed image overrides the shared configured image", async () => {
  const previousShared = process.env.EI_POINT_EMBED_IMAGE_URL;
  const previousHimiko = process.env.EI_POINT_EMBED_IMAGE_HIMIKO;
  process.env.EI_POINT_EMBED_IMAGE_URL = "https://example.test/shared.png";
  process.env.EI_POINT_EMBED_IMAGE_HIMIKO = "https://example.test/himiko.png";
  try {
    assert.equal(resolveEmbedImage("himiko"), "https://example.test/himiko.png");
    assert.equal(resolveEmbedImage("kafka"), "https://example.test/shared.png");
    assert.equal(createEiEmbed({ title: "Rank", description: "Level 3", imageKey: "himiko" }).toJSON().image?.url, "https://example.test/himiko.png");
    let payload: Record<string, unknown> | undefined;
    const interaction = withEiEmbedReplies({ reply: async (value: unknown) => { payload = value as Record<string, unknown>; } }, "himiko");
    await interaction.reply("Rank: 3");
    const embeds = payload?.embeds as EmbedBuilder[];
    assert.equal(embeds[0]?.toJSON().image?.url, "https://example.test/himiko.png");
  } finally {
    if (previousShared === undefined) delete process.env.EI_POINT_EMBED_IMAGE_URL;
    else process.env.EI_POINT_EMBED_IMAGE_URL = previousShared;
    if (previousHimiko === undefined) delete process.env.EI_POINT_EMBED_IMAGE_HIMIKO;
    else process.env.EI_POINT_EMBED_IMAGE_HIMIKO = previousHimiko;
  }
});

test("blank image configuration falls back to the brand default", () => {
  const previousShared = process.env.EI_POINT_EMBED_IMAGE_URL;
  process.env.EI_POINT_EMBED_IMAGE_URL = "   ";
  try {
    assert.equal(
      resolveEmbedImage(),
      "https://raw.githubusercontent.com/xyanncat/Ei-point/main/docs/assets/ei-point-pulse.gif",
    );
  } finally {
    if (previousShared === undefined) delete process.env.EI_POINT_EMBED_IMAGE_URL;
    else process.env.EI_POINT_EMBED_IMAGE_URL = previousShared;
  }
});

test("common command replies use the configured image", async () => {
  const previousShared = process.env.EI_POINT_EMBED_IMAGE_URL;
  process.env.EI_POINT_EMBED_IMAGE_URL = "https://example.test/common.png";
  try {
    const replies: Array<Record<string, unknown>> = [];
    const interaction = {
      commandName: "ping",
      client: { ws: { ping: 12 } },
      deferred: false,
      replied: false,
      editReply: async () => {},
      reply: async (value: Record<string, unknown>) => { replies.push(value); },
    };
    const handled = await respondToCommonCommand(interaction as never, "Himiko", "responsibilities");
    assert.equal(handled, true);
    const embeds = replies[0]?.embeds as EmbedBuilder[];
    assert.equal(embeds[0]?.toJSON().image?.url, "https://example.test/common.png");
  } finally {
    if (previousShared === undefined) delete process.env.EI_POINT_EMBED_IMAGE_URL;
    else process.env.EI_POINT_EMBED_IMAGE_URL = previousShared;
  }
});
