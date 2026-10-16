import { expect, test } from "@playwright/test";
import { fitsViewport, imageLoaded, trackPageErrors } from "./helpers";

const guildId = "111111111111111111";

const overview = (id: string) => ({
  guild: { guildId: id, name: "QA guild", approved: true, scopes: ["*"] },
  cards: [
    {
      botKey: "moderation",
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

test("module configuration saves with version and CSRF; infrastructure accounts manage end to end", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const mutations: Array<{
    path: string;
    method: string;
    body: Record<string, unknown>;
  }> = [];
  let emptyGuilds = false;
  let version = 0;
  let config: Record<string, unknown> = { automod_warnings: true };
  let accounts: Array<Record<string, unknown>> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    let body: Record<string, unknown> = {};
    if (!["GET", "HEAD"].includes(method)) {
      expect(request.headers()["x-csrf-token"]).toBe("qa-csrf-token");
      body = request.postDataJSON() as Record<string, unknown>;
      mutations.push({ path, method, body });
    }
    let result: unknown;
    if (path === "/api/auth/me") {
      result = {
        user: { id: "qa-admin", name: "QA operator" },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        isAdmin: true,
      };
    } else if (path === "/api/auth/csrf") {
      result = { csrfToken: "qa-csrf-token" };
    } else if (path === "/api/guilds") {
      result = {
        guilds: emptyGuilds
          ? []
          : [{ guildId, name: "QA guild", approved: true, scopes: ["*"] }],
      };
    } else if (path === "/api/overview") {
      result = overview(guildId);
    } else if (path.endsWith("/configuration/moderation")) {
      if (method === "PUT") {
        expect(body.expectedVersion).toBe(version);
        version += 1;
        config = body.config as Record<string, unknown>;
      }
      result = {
        configuration: { version, value: config, applied_at: null },
        fields: [
          { key: "automod_warnings", label: "AI warnings", type: "boolean", default: true },
        ],
      };
    } else if (path === "/api/admin/guilds") {
      result = { guilds: [] };
    } else if (path === "/api/admin/staff-scopes") {
      result = { scopes: [] };
    } else if (path === "/api/admin/secrets") {
      result = { secrets: [] };
    } else if (path === "/api/admin/accounts") {
      if (method === "POST") {
        accounts = [{ id: "12345678-1234-1234-1234-123456789abc", ...body }];
        result = { account: accounts[0] };
      } else {
        result = { accounts };
      }
    } else if (path.startsWith("/api/admin/accounts/")) {
      if (method === "PATCH") accounts = [{ ...accounts[0], ...body }];
      if (method === "DELETE") accounts = [];
      result = { account: accounts[0], ok: true };
    } else {
      throw new Error(`Unexpected API ${method} ${path}`);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/dashboard");
  await expect(page).toHaveTitle(/Ei point/);
  await page.getByRole("button", { name: "Configuration", exact: true }).click();
  await page.getByLabel("AI warnings", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Configuration saved." }),
  ).toBeVisible();
  expect(config.automod_warnings).toBe(false);
  expect(version).toBe(1);
  emptyGuilds = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Authorization & vault" }),
  ).toBeVisible();
  expect(
    await page.getByRole("heading", { name: "No server access yet" }).count(),
  ).toBe(0);
  await page.getByLabel("Account name", { exact: true }).fill("QA database");
  await page.getByLabel("Vault secret reference").fill("QA_DATABASE");
  await page
    .getByLabel("Endpoint without credentials")
    .fill("postgresql://localhost:5432/qa");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit QA database", exact: true }),
  ).toBeVisible();
  expect(accounts[0]?.provider).toBe("postgres");
  expect(accounts[0]?.secret_ref).toBe("QA_DATABASE");
  await page
    .getByRole("button", { name: "Edit QA database", exact: true })
    .click();
  await page.getByLabel("Region", { exact: true }).fill("riyadh");
  await page
    .getByRole("button", { name: "Save account changes", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Infrastructure account saved." }),
  ).toBeVisible();
  expect(accounts[0]?.region).toBe("riyadh");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await fitsViewport(page)).toBe(true);
  await page
    .getByRole("button", { name: "Delete QA database", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Infrastructure account deleted." }),
  ).toBeVisible();
  expect(accounts.length).toBe(0);
  expect(errors).toEqual([]);
  expect(mutations.map((mutation) => mutation.method)).toEqual([
    "PUT",
    "POST",
    "PATCH",
    "DELETE",
  ]);
});

test("dashboard states: search, modal focus, guild switch, reduced motion, stale, sign-in, empty access and unavailable", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.goto("/dashboard");
  await expect(page.locator(".cc-bot")).toHaveCount(6);
  await expect(page).toHaveTitle(/Ei point/);
  await page.locator(".cc-bot").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Assigned modules");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(
    await page
      .locator(".cc-bot")
      .first()
      .evaluate((element) => element === document.activeElement),
  ).toBe(true);
  await page.keyboard.press("/");
  expect(
    await page
      .getByRole("textbox", { name: "Search bots and modules" })
      .evaluate((element) => element === document.activeElement),
  ).toBe(true);
  await page.getByRole("textbox", { name: "Search bots and modules" }).fill("music");
  await expect(page.locator(".cc-bot")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search bots and modules" }).fill("");
  await page
    .getByRole("combobox", { name: "Choose server" })
    .selectOption("222222222222222222");
  await expect(
    page.locator(".cc-page-heading").getByText("Royality staging", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".cc-sidebar")
    .evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
  expect(await fitsViewport(page)).toBe(true);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Bot fleet", exact: true }).click();
  await expect(page.locator(".cc-bot")).toHaveCount(6);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".cc-bot")
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe("0s");
  await page.route("**/api/overview?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "db-unavailable",
        error: "Database unavailable. Retry shortly.",
        correlationId: "ui-test",
      }),
    }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Live update unavailable. Showing the last snapshot."),
  ).toBeVisible();
  await expect(page.locator(".cc-notice")).toContainText("Showing the last snapshot");
  await page.unroute("**/api/overview?*");
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "auth-required", error: "Sign in" }),
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Continue with Discord" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue with Discord" }),
  ).toHaveAttribute("href", "/api/auth/login");
  await expect(page.locator(".cc-login-portrait")).toBeVisible();
  expect(
    await imageLoaded(page.locator(".cc-login-portrait img").first()),
  ).toBe(true);
  await page.unroute("**/api/auth/me");
  await page.route("**/api/guilds", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ guilds: [] }),
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No server access yet" }),
  ).toBeVisible();
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "service-unavailable", error: "Account unavailable" }),
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Workspace unavailable" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
