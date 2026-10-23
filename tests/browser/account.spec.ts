import { expect, test } from "@playwright/test";
import { fitsViewport, trackPageErrors } from "./helpers";

const CTA = /Continue with Discord/;

test("login: branding, one action, safe returnTo, error states, keyboard and mobile", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Ei point" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Take your place." })).toBeVisible();
  await expect(page.getByRole("link", { name: CTA })).toHaveAttribute(
    "href",
    "/api/auth/login?returnTo=%2Faccount",
  );
  await expect(page.getByText("You will return to /account after signing in.")).toBeVisible();

  // intended page is preserved after authentication
  await page.goto("/login?returnTo=%2Faccount%2Forders");
  await expect(page.getByRole("link", { name: CTA })).toHaveAttribute(
    "href",
    "/api/auth/login?returnTo=%2Faccount%2Forders",
  );
  await expect(page.getByText("You will return to /account/orders after signing in.")).toBeVisible();

  // protocol-relative and backslash targets are dropped, never trusted
  await page.goto("/login?returnTo=//evil.example");
  await expect(page.getByRole("link", { name: CTA })).toHaveAttribute(
    "href",
    "/api/auth/login?returnTo=%2Faccount",
  );
  await page.goto("/login?returnTo=/\\evil");
  await expect(page.getByRole("link", { name: CTA })).toHaveAttribute(
    "href",
    "/api/auth/login?returnTo=%2Faccount",
  );

  // denied / expired / failed / unconfigured states explain themselves
  await page.goto("/login?error=denied");
  await expect(page.getByRole("status")).toContainText("cancelled or denied");
  await page.goto("/login?error=expired");
  await expect(page.getByRole("status")).toContainText("expired");
  await page.goto("/login?error=failed");
  await expect(page.getByRole("status")).toContainText("failed on our side");
  await page.goto("/login?error=not-configured");
  await expect(page.getByRole("status")).toContainText("not configured");

  // keyboard reaches actions with a visible outline
  await page.goto("/login");
  await page.evaluate(() => document.body.focus());
  let visible = 0;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const ok = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement);
      return cs.outlineStyle === "solid" && parseFloat(cs.outlineWidth) >= 2;
    });
    if (ok) visible++;
  }
  expect(visible).toBeGreaterThan(0);

  // mobile composition
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.getByRole("link", { name: CTA })).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("account pages: signed-out states keep sign-in one click away with safe returns", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "auth-required", error: "Sign in" }),
    }),
  );
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with Discord" }),
  ).toHaveAttribute("href", "/login");
  // direct URLs render their own honest states while signed out
  for (const route of ["/account/servers", "/account/services", "/account/orders"]) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: "Sign in to continue" }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("the account area offers the services tab only to the operator and the master", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const member = {
    user: { id: "qa-member", name: "QA member" },
    role: "user",
    isAdmin: false,
    isMaster: false,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(member) }),
  );
  await page.goto("/account/servers");
  await expect(page.getByRole("link", { name: "Servers", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Purchase logs", exact: true })).toBeVisible();
  // The catalogue tab is not offered to a plain customer…
  expect(await page.getByRole("link", { name: "Services", exact: true }).count()).toBe(0);
  // …and the page itself refuses them.
  await page.goto("/account/services");
  await expect(
    page.getByRole("heading", { name: "Not available for your role" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
