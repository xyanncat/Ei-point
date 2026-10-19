import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";
import { trackPageErrors } from "./helpers";

const FIRST = "111111111111111111";
const SECOND = "222222222222222222";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("moderation: incident filtering, filtered-empty state and server isolation on switch", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const seenGuilds: string[] = [];
  const overviewFor = (guildId: string) => ({
    guild: { guildId, name: guildId === FIRST ? "First guild" : "Second guild", approved: true, scopes: ["*"] },
    cards: [],
    stale: false,
    fetchedAt: new Date().toISOString(),
    incidents: [
      { id: "i1", kind: "raid-threshold", severity: "high", createdAt: new Date().toISOString() },
      { id: "i2", kind: "message-flood", severity: "medium", createdAt: new Date().toISOString() },
    ],
    actions: [],
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/auth/me")
      return json(route, { user: { id: "qa", name: "QA" }, expiresAt: new Date(Date.now() + 3600000).toISOString(), isAdmin: true });
    if (path === "/api/guilds")
      return json(route, {
        guilds: [
          { guildId: FIRST, name: "First guild", approved: true, scopes: ["*"] },
          { guildId: SECOND, name: "Second guild", approved: true, scopes: ["*"] },
        ],
      });
    if (path === "/api/overview") {
      const guildId = url.searchParams.get("guildId") ?? FIRST;
      seenGuilds.push(guildId);
      return json(route, overviewFor(guildId));
    }
    return json(route, { error: "Unexpected " + path, code: "test-unexpected" }, 404);
  });

  await page.goto("/dashboard/moderation");
  await expect(page.locator(".sf-table tbody tr")).toHaveCount(2);
  await page.getByLabel("Find an event").fill("flood");
  await expect(page.locator(".sf-table tbody tr")).toHaveCount(1);
  await page.getByLabel("Find an event").fill("");
  await page.getByLabel("Severity").selectOption("high");
  await expect(page.locator(".sf-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".sf-table tbody tr").first()).toContainText("raid threshold");
  await page.getByLabel("Find an event").fill("no such event");
  await expect(page.getByText("No incidents match the filter")).toBeVisible();
  await page.getByLabel("Find an event").fill("");
  await page.getByLabel("Severity").selectOption("all");

  await page.getByRole("combobox", { name: "Choose server" }).selectOption(SECOND);
  await expect.poll(() => seenGuilds.includes(SECOND)).toBe(true);
  await expect(page.locator(".sf-table tbody tr")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("announcements: URL typing, native validation, queue acknowledgement and history refresh", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  let jobs = [{ job_id: "job-1", kind: "embed", status: "delivered" }];
  let embedsGets = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/auth/me")
      return json(route, { user: { id: "qa", name: "QA" }, expiresAt: new Date(Date.now() + 3600000).toISOString(), isAdmin: true });
    if (path === "/api/guilds")
      return json(route, { guilds: [{ guildId: FIRST, name: "First guild", approved: true, scopes: ["*"] }] });
    if (path === "/api/overview")
      return json(route, {
        guild: { guildId: FIRST, name: "First guild", approved: true, scopes: ["*"] },
        cards: [],
        stale: false,
        fetchedAt: new Date().toISOString(),
        incidents: [],
        actions: [],
      });
    if (path === `/api/guilds/${FIRST}/bot-state`)
      return json(route, { bots: [{ bot_key: "himiko", modules: ["announcements"], enabled: true, paused: false }] });
    if (path === `/api/guilds/${FIRST}/embeds` && method === "GET") {
      embedsGets += 1;
      return json(route, { jobs });
    }
    if (path === `/api/guilds/${FIRST}/embeds` && method === "POST") {
      jobs = [{ job_id: "job-9", kind: "embed", status: "queued" }, ...jobs];
      return json(route, { queued: true, job_id: "job-9", status: "queued" });
    }
    if (path === "/api/auth/csrf") return json(route, { csrfToken: "qa-csrf" });
    return json(route, { error: "Unexpected " + path, code: "test-unexpected" }, 404);
  });

  await page.goto("/dashboard/community/announcements");
  await expect(page.getByRole("textbox", { name: "Title URL" })).toHaveAttribute("type", "url");
  const getsBefore = embedsGets;
  // Native validation blocks the submit while the required fields are empty.
  await page.getByRole("button", { name: "Queue embed" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Embed accepted" })).toHaveCount(0);
  await page.getByLabel("Sending bot").selectOption("himiko");
  await page.getByLabel("Channel ID").fill("123456789012345678");
  await page.getByRole("button", { name: "Queue embed" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Embed accepted by the durable delivery queue" }),
  ).toBeVisible();
  await expect.poll(() => embedsGets).toBeGreaterThan(getsBefore);
  // The refreshed history distinguishes queued from delivered.
  await expect(page.getByText("job-9")).toBeVisible();
  await expect(page.getByText("job-1")).toBeVisible();
  expect(errors).toEqual([]);
});

test("commerce and vault: read-only cannot settle; settlement appears with permission; reveal denies and stays masked", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  let scopes = ["commerce"];
  const order = {
    orderId: "RP-ABCDEF",
    buyerId: "111111111111111111",
    serviceName: "Membership",
    amountMinor: 70000,
    method: "upi",
    status: "claimed",
    createdAt: new Date().toISOString(),
    proofRef: "utr-1",
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/auth/me")
      return json(route, { user: { id: "qa", name: "QA" }, expiresAt: new Date(Date.now() + 3600000).toISOString(), isAdmin: true });
    if (path === "/api/guilds")
      return json(route, { guilds: [{ guildId: FIRST, name: "First guild", approved: true, scopes }] });
    if (path === "/api/overview")
      return json(route, {
        guild: { guildId: FIRST, name: "First guild", approved: true, scopes },
        cards: [],
        stale: false,
        fetchedAt: new Date().toISOString(),
        incidents: [],
        actions: [],
      });
    if (path === `/api/guilds/${FIRST}/commerce/orders`) return json(route, { orders: [order] });
    if (path === "/api/admin/secrets" && method === "GET")
      return json(route, { secrets: [{ name: "TOKEN_ALPHA", masked: "••••••••0ma", updated_at: new Date().toISOString() }] });
    if (path.startsWith("/api/admin/secrets/") && method === "POST")
      return json(route, { error: "Not permitted in this test", code: "test-denied" }, 403);
    return json(route, { error: "Unexpected " + path, code: "test-unexpected" }, 404);
  });

  await page.goto("/dashboard/commerce/payments");
  await expect(page.getByRole("button", { name: "Review" })).toBeVisible();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Settle verified transfer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reject order" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // Settlement permission reveals the controls (nothing is clicked).
  scopes = ["*"];
  await page.reload();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("button", { name: "Settle verified transfer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject order" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Vault: masked by default; a denied reveal surfaces the error, not a value.
  await page.goto("/dashboard/system/vault");
  await expect(page.getByText("••••••••0ma")).toBeVisible();
  await page.getByRole("button", { name: "Reveal TOKEN_ALPHA" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Access denied" })).toBeVisible();
  expect(await page.getByText("test-secret-value").count()).toBe(0);
  expect(errors).toEqual([]);
});
