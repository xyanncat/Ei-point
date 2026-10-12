import test from "node:test";
import assert from "node:assert/strict";
import { registeredBotToken, sendDashboardEmbed } from "./embed-delivery.js";
const target = "123456789012345678",
  bot = "223456789012345678";
test("dynamic identity token resolves only its named environment credential", () => {
  assert.equal(
    registeredBotToken("crew-new", {
      DISCORD_CREW_NEW_BOT_TOKEN: "named",
      BOT_TOKEN: "wrong",
    }),
    "named",
  );
  assert.equal(
    registeredBotToken("crew-new", { BOT_TOKEN: "wrong" }),
    undefined,
  );
  assert.equal(
    registeredBotToken("crew-new", {
      BOT_KEY: "crew-new",
      BOT_TOKEN: "correct",
    }),
    "correct",
  );
});
test("mismatched identity and cross-guild channel never send messages", async () => {
  for (const mismatch of ["identity", "guild"]) {
    const paths: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      const path = String(url);
      paths.push(path);
      return new Response(
        JSON.stringify(
          path.endsWith("/users/@me")
            ? { id: mismatch === "identity" ? "wrong" : bot, bot: true }
            : { guild_id: "another", type: 0 },
        ),
        { status: 200 },
      );
    }) as typeof fetch;
    await assert.rejects(() =>
      sendDashboardEmbed(
        {
          guild_id: target,
          channel_id: target,
          color: "#abcdef",
          title: "Hello",
        },
        "private",
        bot,
        fetchFn,
      ),
    );
    assert.ok(paths.every((p) => !p.endsWith("/messages")));
  }
});
test("valid staff embed send preserves Discord limits, disables mentions and uses stable nonce", async () => {
  let body: any;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/messages")) {
      body = JSON.parse(String(init?.body));
      return new Response('{"id":"message"}', { status: 200 });
    }
    return new Response(
      JSON.stringify(
        path.endsWith("/users/@me")
          ? { id: bot, bot: true }
          : { guild_id: target, type: 0 },
      ),
      { status: 200 },
    );
  }) as typeof fetch;
  await sendDashboardEmbed(
    {
      guild_id: target,
      channel_id: target,
      title: "Hello",
      color: "#abcdef",
      description: "Preview",
      footer: "Footer",
      author: { name: "Staff", iconUrl: "https://example.org/icon.png" },
      buttons: [{ label: "Open", url: "https://example.org" }],
      delivery_nonce: "stable-job",
    },
    "private",
    bot,
    fetchFn,
  );
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.nonce, "stable-job");
  assert.equal(body.enforce_nonce, true);
  assert.equal(body.embeds[0].color, 0xabcdef);
  assert.equal(body.embeds[0].author.icon_url, "https://example.org/icon.png");
  assert.equal(body.components[0].components[0].style, 5);
});
