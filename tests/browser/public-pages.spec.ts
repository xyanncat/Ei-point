import { expect, test } from "@playwright/test";
import { fitsViewport, imageLoaded, trackPageErrors } from "./helpers";

const publicRoutes = [
  "/",
  "/services",
  "/membership",
  "/referrals",
  "/verify",
  "/help",
  "/missing-kafka-page",
];

for (const route of publicRoutes) {
  test(`renders ${route} on desktop and mobile without overflow`, async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(route);
      await expect(page).toHaveTitle(/Ei point/);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await fitsViewport(page)).toBe(true);
      expect(
        await imageLoaded(page.locator(".ei-brand-mark img").first()),
      ).toBe(true);
      expect(
        await imageLoaded(page.locator(".ei-page-art>img").first()),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test("ambient and artwork motion pause and respect reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause ambient motion" }).click();
  expect(
    await page
      .locator(".ei-atmosphere svg")
      .first()
      .evaluate((element) => getComputedStyle(element).animationPlayState),
  ).toBe("paused");
  await page.getByRole("button", { name: "Resume ambient motion" }).click();
  await page.getByRole("button", { name: "Pause artwork motion" }).first().click();
  expect(
    await page
      .locator(".ei-page-art>img")
      .first()
      .evaluate((element) => getComputedStyle(element).animationPlayState),
  ).toBe("paused");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".ei-page-art>img")
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

test("homepage and dashboard heroes load, pause and respect reduced motion", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  for (const route of ["/", "/dashboard"]) {
    await page.goto(route);
    await expect(page.locator(".kafka-character")).toBeVisible();
    expect(await imageLoaded(page.locator(".kafka-character"))).toBe(true);
    await page.getByRole("button", { name: "Pause character animation" }).click();
    expect(
      await page
        .locator(".kafka-character")
        .evaluate((element) => getComputedStyle(element).animationPlayState),
    ).toBe("paused");
    await page
      .getByRole("button", { name: "Resume character animation" })
      .click();
    expect(
      await page
        .locator(".kafka-character")
        .evaluate((element) => getComputedStyle(element).animationPlayState),
    ).toBe("running");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await fitsViewport(page)).toBe(true);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".kafka-character")
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  expect(errors).toEqual([]);
});

test("service filters narrow the catalog and the empty state explains the search", async ({
  page,
}) => {
  await page.goto("/services");
  const all = await page.locator(".ei-service-list article").count();
  expect(all).toBeGreaterThan(0);
  await page
    .getByLabel("Game", { exact: true })
    .selectOption("Honkai: Star Rail");
  const starRail = await page.locator(".ei-service-list article").count();
  expect(starRail).toBeGreaterThan(0);
  expect(starRail).toBeLessThan(all);
  await page.getByLabel("Find a service").fill("no such service");
  await expect(
    page.getByText("No services match this search. Try a different game or name."),
  ).toBeVisible();
  await page.getByLabel("Find a service").fill("");
  expect(await page.locator(".ei-service-list article").count()).toBe(starRail);
  await page.getByLabel("Game", { exact: true }).selectOption("All games");
  expect(await page.locator(".ei-service-list article").count()).toBe(all);
  await page.goto("/cards");
  await expect(
    page.getByRole("heading", { name: "The collection is waiting" }),
  ).toBeVisible();
  await page.goto("/about");
  expect(await page.getByRole("link", { name: /Discord profile/ }).count()).toBeGreaterThan(0);
  await page.goto("/help");
  await page.getByText("How do payments work?").click();
  await expect(
    page.getByText("Choose a service, sign in with Discord"),
  ).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test("verification page covers empty, short, unknown and matching states", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.goto("/verify");
  expect(
    await page.getByRole("heading", { name: "Check your token" }).count(),
  ).toBe(0);
  await page.goto("/verify?token=short");
  await expect(
    page.getByRole("heading", { name: "Check your token" }),
  ).toBeVisible();
  await page
    .getByLabel("Or your verification token")
    .fill("unknown-verification-token");
  await page.getByRole("button", { name: "Check order", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Order not available" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/token=unknown-verification-token/);
  await page.goto("/verify?token=demo-verification-token");
  await expect(page.getByRole("heading", { name: "Order details" })).toBeVisible();
  await expect(page.getByText("Demo Membership")).toBeVisible();
  await page.goto("/verify?id=RP-DEMO01");
  await expect(page.getByRole("heading", { name: "Order details" })).toBeVisible();
  await page.goto("/verify?id=nope");
  await expect(
    page.getByRole("heading", { name: "Order not available" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("services page navigates to verification", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/services");
  await page.getByRole("link", { name: "Verify order", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe("/verify");
  expect(errors).toEqual([]);
});

test("service details render archive facts with an honest purchase entry; unknown slugs reach not-found", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.goto("/services/account-management-membership");
  await expect(
    page.getByRole("heading", { name: "All-Games Account Management Membership (30 Days)" }),
  ).toBeVisible();
  await expect(page.getByText("₹700").first()).toBeVisible();
  expect(await page.getByRole("button", { name: /Checkout/i }).count()).toBeGreaterThan(0);
  expect(await page.getByRole("link", { name: "← All services" }).count()).toBe(1);
  await page.goto("/services/not-a-real-service");
  await expect(page.getByRole("heading", { name: "A loose thread." })).toBeVisible();
  expect(await page.getByRole("link", { name: "Return to Ei point" }).count()).toBe(1);
  expect(errors).toEqual([]);
});
