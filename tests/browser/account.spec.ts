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
  await expect(page.getByRole("heading", { name: "Sign in to see your account" })).toBeVisible();
  await expect(page.getByRole("link", { name: CTA })).toHaveAttribute(
    "href",
    "/login?returnTo=%2Faccount",
  );
  await page.goto("/account/settings");
  await expect(page.getByText("You are signed out.")).toBeVisible();
  await expect(page.getByRole("link", { name: CTA })).toHaveAttribute(
    "href",
    "/login?returnTo=%2Faccount%2Fsettings",
  );
  // direct URLs render their own honest states while signed out
  await page.goto("/account/membership");
  await expect(page.getByRole("heading", { name: "Membership", exact: true })).toBeVisible();
  await page.goto("/account/referrals");
  await expect(page.getByRole("heading", { name: "Referrals", exact: true })).toBeVisible();
  await page.goto("/account/orders");
  await expect(page.getByRole("heading", { name: "My orders", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("orders: lookup validation and order detail states against the demo status service", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.goto("/account/orders");
  await page.getByLabel("Order ID").fill("abc");
  await page.getByRole("button", { name: "Open order" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Order IDs look like RP-ABC123" }),
  ).toBeVisible();
  await page.getByLabel("Order ID").fill("rp-demo01");
  await page.getByRole("button", { name: "Open order" }).click();
  await page.waitForURL("**/account/orders/RP-DEMO01");
  await expect(page.getByRole("heading", { name: "Order RP-DEMO01" })).toBeVisible();
  await expect(page.getByText("Demo Membership")).toBeVisible();
  await expect(page.getByText("Payment received and verified.")).toBeVisible();
  await expect(page.getByText("Status view — no buyer details are shown here.")).toBeVisible();
  await page.goto("/account/orders/NOPE-1");
  await expect(page.getByText("No order matches this ID")).toBeVisible();
  expect(errors).toEqual([]);
});
