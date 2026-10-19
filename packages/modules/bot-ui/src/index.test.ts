import test from "node:test";
import assert from "node:assert/strict";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import {
  commonCommandDefinitions,
  createEiEmbed,
  identityTheme,
  isCommonCommand,
  toEiComponentPayload,
  toEiEmbedPayload,
  withEiEmbedReplies,
} from "./index.js";

test("common commands retain their names", () => {
  assert.deepEqual(commonCommandDefinitions().map((command) => command.name), ["botinfo", "ping", "about"]);
  assert.equal(isCommonCommand("about"), true);
  assert.equal(isCommonCommand("ask"), false);
});

test("legacy text and embed fields become container text without losing either", async () => {
  let sent: any;
  const interaction = withEiEmbedReplies({ reply: async (payload: unknown) => { sent = payload; } });
  await interaction.reply({
    content: "Preview is ready.",
    embeds: [new EmbedBuilder().setTitle("Custom").setDescription("Custom body").addFields({ name: "Status", value: "Ready" })],
  });
  assert.equal(sent.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
  assert.equal(sent.content, undefined);
  assert.equal(sent.embeds, undefined);
  assert.equal(sent.components[0].type, 17);
  assert.equal(sent.components[0].accent_color, undefined);
  const body = JSON.stringify(sent.components);
  for (const text of ["Preview is ready.", "Custom", "Custom body", "Status", "Ready"]) assert.ok(body.includes(text));
});

test("brand media and empty text remain visible", () => {
  const previous = process.env.EI_POINT_EMBED_IMAGE_URL;
  process.env.EI_POINT_EMBED_IMAGE_URL = "https://example.test/brand.png";
  try {
    assert.equal(createEiEmbed({ title: "Test", description: "Body" }).toJSON().image?.url, "https://example.test/brand.png");
    const body = JSON.stringify(toEiEmbedPayload(""));
    assert.ok(body.includes("No additional details."));
    assert.ok(body.includes("https://example.test/brand.png"));
    assert.ok(body.includes("\"type\":12"));
  } finally {
    if (previous === undefined) delete process.env.EI_POINT_EMBED_IMAGE_URL;
    else process.env.EI_POINT_EMBED_IMAGE_URL = previous;
  }
});

test("files and buttons are rendered inside the container and uploads survive", () => {
  const files = [{ attachment: Buffer.from("audio"), name: "cyrene.wav" }];
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("cancel:123").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  const payload = toEiComponentPayload({ content: "Ready", files, components: [row], ephemeral: true });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  const children = (payload.components[0] as any).components;
  assert.ok(children.some((child: any) => child.type === 13 && child.file.url === "attachment://cyrene.wav"));
  assert.ok(JSON.stringify(children).includes("cancel:123"));
  assert.equal((payload as any).files, files);
  assert.equal((payload.components[0] as any).accent_color, undefined);
});

test("V2 payloads pass through repeated wrapping without duplicate containers", () => {
  const first = toEiComponentPayload({ content: "Done", allowedMentions: { users: ["123"] } });
  const second = toEiComponentPayload(first as never);
  assert.deepEqual(second, first);
});

test("deferred edit and followup conversion preserves methods, flags and mention restrictions", async () => {
  const seen: any[] = [];
  const target = {
    deferred: true,
    editReply: async function (value: unknown) { assert.equal(this.deferred, true); seen.push(value); },
    followUp: async (value: unknown) => { seen.push(value); },
  };
  const interaction = withEiEmbedReplies(target);
  await interaction.editReply("Finished");
  await interaction.followUp({ content: "Private", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  assert.equal((seen[0] as any).flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
  assert.equal((seen[1] as any).flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.deepEqual((seen[1] as any).allowedMentions, { parse: [] });
});

test("per-identity image override and colourless footer survive conversion", () => {
  const previousShared = process.env.EI_POINT_EMBED_IMAGE_URL;
  const previousHimiko = process.env.EI_POINT_EMBED_IMAGE_HIMIKO;
  process.env.EI_POINT_EMBED_IMAGE_URL = "https://example.test/shared.png";
  process.env.EI_POINT_EMBED_IMAGE_HIMIKO = "https://example.test/himiko.png";
  try {
    const payload = toEiComponentPayload({ content: "Hello" }, "himiko");
    const body = JSON.stringify(payload);
    assert.ok(body.includes("https://example.test/himiko.png"));
    assert.ok(body.includes("Himiko"));
    assert.equal((payload.components[0] as any).accent_color, undefined);
    assert.equal(identityTheme("himiko")?.color, 0xb0304c);
  } finally {
    if (previousShared === undefined) delete process.env.EI_POINT_EMBED_IMAGE_URL;
    else process.env.EI_POINT_EMBED_IMAGE_URL = previousShared;
    if (previousHimiko === undefined) delete process.env.EI_POINT_EMBED_IMAGE_HIMIKO;
    else process.env.EI_POINT_EMBED_IMAGE_HIMIKO = previousHimiko;
  }
});
