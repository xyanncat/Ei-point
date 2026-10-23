import { expect, test } from "@playwright/test";
import { fitsViewport, trackPageErrors } from "./helpers";

const publicRoutes = [
  "/",
  "/services",
  "/membership",
  "/referrals",
  "/cards",
  "/verify",
  "/about",
  "/docs",
  "/terms",
  "/policy",
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
      // The brand mark is drawn in CSS, never loaded from a file.
      await expect(page.locator(".ei-brand-mark").first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("the film is the page: full bleed, looping, and nobody has to press play", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.goto("/");
  const film = page.locator(".world__video");
  await expect(film).toHaveAttribute("loop", "");
  await expect(film).toHaveAttribute("autoplay", "");

  // The whole 2:30 film, at its native resolution, in a format browsers take.
  const sources = await film.locator("source").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("src")),
  );
  expect(sources.some((src) => src?.includes("film-1080"))).toBe(true);
  expect(sources.some((src) => src?.includes("film-540"))).toBe(true);
  await expect
    .poll(
      async () =>
        film.evaluate((element) => (element as HTMLVideoElement).duration),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(140);

  // It covers the viewport and plays without a control anywhere.
  const box = await film.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(1400);
  expect(await film.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(
    false,
  );
  expect(
    await page.getByRole("button", { name: /pause|play the film|mut/i }).count(),
  ).toBe(0);

  // The soundtrack is part of the film, not a control.
  await expect(page.locator("audio")).toHaveCount(1);

  // Reduced motion means the still frame, not the film.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(film).toBeHidden();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(errors).toEqual([]);
});

test("scrolling walks the film's scenes and reframes the picture", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await page.goto("/");
  const scenes = page.locator(".scene");
  expect(await scenes.count()).toBeGreaterThanOrEqual(6);

  // The first scene's headline is on screen before any scrolling.
  const first = await page.locator(".scene .world-title").first().textContent();
  expect(first?.trim().length).toBeGreaterThan(0);

  // Scrolling moves the crop of the film, so the picture reframes with the copy.
  const cropAt = async () =>
    page.locator(".world__video").evaluate(
      (element) => getComputedStyle(element).objectPosition,
    );
  const before = await cropAt();
  await page.evaluate(() => window.scrollTo({ top: 2600, behavior: "instant" }));
  await page.waitForTimeout(900);
  const after = await cropAt();
  expect(after).not.toBe(before);

  // Every scene is reachable and the copy is still there.
  const last = await page.locator(".scene .world-title").last().textContent();
  expect(last?.trim().length).toBeGreaterThan(0);
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
  await expect(
    page.getByRole("heading", { name: /A small operation/ }),
  ).toBeVisible();
  await page.goto("/docs");
  await expect(
    page.getByRole("heading", { name: "Getting started" }),
  ).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);
});

test("the old help address lands on the docs", async ({ page }) => {
  await page.goto("/help");
  await expect(page).toHaveURL(/\/docs$/);
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
  await page.getByRole("link", { name: "Verify an order", exact: true }).click();
  await page.waitForURL("**/verify");
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
  await expect(
    page.getByRole("heading", { name: /Nothing/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
