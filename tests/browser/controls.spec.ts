import { expect, test } from "@playwright/test";
import { fitsViewport, trackPageErrors } from "./helpers";

const guildId = "111111111111111111";

const overview = (id: string) => ({
  guild: { guildId: id, name: "QA guild", approved: true, scopes: ["*"] },
  cards: [
    {
      botKey: "kafka",
      modules: ["moderation"],
      state: "ok",
      gateway: "ok",
      dbReady: true,
      latencyMs: 12,
      updatedAt: new Date().toISOString(),
    },
  ],
  stale: false,
  fetchedAt: new Date().toISOString(),
  incidents: [],
  actions: [],
});

/**
 * The account area talks to a small, explicit set of endpoints. Each test
 * below swaps the ones it cares about and fails loudly on anything else.
 */
async function stubApi(
  page: import("@playwright/test").Page,
  options: {
    role?: "user" | "admin" | "master";
    guilds?: unknown[];
    catalogue?: unknown[];
    onCatalogSave?: (body: Record<string, unknown>) => void;
  } = {},
) {
  const role = options.role ?? "master";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: Record<string, unknown> = {};
    if (!["GET", "HEAD"].includes(method)) {
      expect(request.headers()["x-csrf-token"]).toBe("qa-csrf-token");
      body = request.postDataJSON() as Record<string, unknown>;
    }
    let result: unknown;
    if (path === "/api/auth/me") {
      result = {
        user: { id: "111111111111111111", name: "QA operator" },
        role,
        isAdmin: role === "admin" || role === "master",
        isMaster: role === "master",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    } else if (path === "/api/auth/csrf") {
      result = { csrfToken: "qa-csrf-token" };
    } else if (path === "/api/guilds") {
      result = { guilds: options.guilds ?? [{ guildId, name: "QA guild", approved: true, scopes: ["*"] }] };
    } else if (path === "/api/overview") {
      result = overview(url.searchParams.get("guildId") ?? guildId);
    } else if (path === "/api/admin/catalog") {
      if (method === "POST") {
        options.onCatalogSave?.(body);
        result = { item: { sku: body.sku, active: true, ...body } };
      } else {
        result = { items: options.catalogue ?? [] };
      }
    } else if (path.startsWith("/api/admin/catalog/")) {
      options.onCatalogSave?.(body);
      result = { item: { sku: "membership", active: true, ...body } };
    } else if (path === "/api/account/orders") {
      result = {
        scope: role === "user" ? "own" : "all",
        orders: [
          {
            orderId: "RP-DEMO01",
            buyerId: "111111111111111111",
            sku: "membership",
            serviceName: "QA Membership",
            amountMinor: 70000,
            method: "upi",
            status: "settled",
            createdAt: new Date().toISOString(),
            expiresAt: null,
            guildId,
            guildName: "QA guild",
          },
        ],
      };
    } else if (path === "/api/master/guilds") {
      result = {
        guilds: [
          {
            guildId,
            name: "QA guild",
            ownerId: "111111111111111111",
            approved: true,
            bots: ["kafka", "cipher"],
          },
        ],
      };
    } else if (path.startsWith("/api/master/guilds/")) {
      result = { ok: true, botKey: "cipher", guildId };
    } else if (path.endsWith("/settings")) {
      result = {
        settings: {
          notifications_enabled: true,
          server_paused: false,
          notification_preferences: {},
        },
      };
    } else if (path.endsWith("/bot-state")) {
      result = { bots: [{ bot_key: "kafka", modules: ["moderation"], enabled: true, paused: false }] };
    } else if (path.endsWith("/command-permissions")) {
      result = { permissions: [] };
    } else if (path.endsWith("/configuration/moderation")) {
      result = {
        configuration: { version: 2, value: { automod_warnings: true }, applied_at: null },
        fields: [
          { key: "automod_warnings", label: "AI warnings", type: "boolean", default: true },
        ],
      };
    } else if (path === "/api/admin/staff-scopes") {
      result = { scopes: [] };
    } else {
      throw new Error(`Unexpected API ${method} ${path}`);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
}

test("the servers tab lists the bots in a server and opens their setup", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await stubApi(page, { role: "user" });
  await page.goto("/account/servers");
  await expect(page.getByRole("heading", { name: "Servers" })).toBeVisible();
  await expect(page.locator(".sf-table tbody tr")).toHaveCount(1);
  await expect(page.getByText("Kafka")).toBeVisible();

  // The setup opens in place. The save bar only appears once a value is
  // changed, because there is nothing to save until then.
  await page.getByRole("button", { name: "Set up" }).click();
  await page.getByLabel("AI warnings", { exact: true }).uncheck();
  await expect(
    page.getByRole("button", { name: "Save configuration", exact: true }),
  ).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("the services tab lets the operator change a price and add a service", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const saved: Record<string, unknown>[] = [];
  await stubApi(page, {
    role: "admin",
    catalogue: [
      {
        sku: "membership",
        name: "QA Membership",
        priceMinor: 70000,
        currency: "INR",
        game: "All games",
        category: "Membership",
        duration: "30 days",
        description: "Thirty days of account management.",
        active: true,
        updatedAt: new Date().toISOString(),
      },
    ],
    onCatalogSave: (body) => saved.push(body),
  });
  await page.goto("/account/services");
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  await expect(page.getByText("QA Membership")).toBeVisible();

  // Edit a price.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByLabel("Price (INR)").fill("900");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("QA Membership was saved.")).toBeVisible();
  expect(saved.at(-1)?.priceMinor).toBe(90000);

  // Add a service.
  await page.getByRole("button", { name: "Add a service" }).click();
  await page.getByLabel("Key").fill("new-service");
  await page.getByLabel("Service name").fill("Brand New Service");
  await page.getByLabel("Price (INR)").fill("1500");
  await page.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByText("Brand New Service was added to the catalogue.")).toBeVisible();
  expect(saved.at(-1)?.sku).toBe("new-service");
  expect(errors).toEqual([]);
});

test("the master sees every server and can remove a bot from one", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await stubApi(page, { role: "master" });
  await page.goto("/account/servers");
  await expect(page.getByRole("heading", { name: "Every server" })).toBeVisible();
  await expect(page.getByText("QA guild").first()).toBeVisible();

  // Removal asks first, then confirms.
  await page
    .getByRole("button", { name: "Remove cipher from this server" })
    .click();
  await expect(page.getByRole("button", { name: "Confirm removal" })).toBeVisible();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("button", { name: "Confirm removal" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the purchase log lists orders for the signed-in customer", async ({ page }) => {
  const errors = trackPageErrors(page);
  await stubApi(page, { role: "user" });
  await page.goto("/account/orders");
  await expect(page.getByRole("heading", { name: "Purchase logs" })).toBeVisible();
  await expect(page.getByText("RP-DEMO01")).toBeVisible();
  await expect(page.getByText("QA Membership")).toBeVisible();
  expect(errors).toEqual([]);
});
