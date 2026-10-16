import { expect, test } from "@playwright/test";
import { fitsViewport, trackPageErrors } from "./helpers";

const first = "111111111111111111";
const second = "222222222222222222";

test("late first-guild payment response cannot overwrite the current guild's orders", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  let release: () => void = () => {};
  let requestedResolve: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    requestedResolve = resolve;
  });
  const guild = (id: string) => ({
    guildId: id,
    name: id === first ? "First guild" : "Second guild",
    approved: true,
    scopes: ["*"],
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let result: unknown;
    if (path === "/api/auth/me") {
      result = {
        user: { id: "qa", name: "QA" },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        isAdmin: true,
      };
    } else if (path === "/api/guilds") {
      result = { guilds: [guild(first), guild(second)] };
    } else if (path === "/api/overview") {
      result = {
        guild: guild(url.searchParams.get("guildId") ?? first),
        cards: [
          {
            botKey: "commerce",
            modules: ["commerce"],
            state: "ok",
            gateway: "ok",
            dbReady: true,
            updatedAt: new Date().toISOString(),
          },
        ],
        stale: false,
        fetchedAt: new Date().toISOString(),
        incidents: [],
        actions: [],
      };
    } else if (path.endsWith("/settings")) {
      result = {
        settings: {
          notifications_enabled: true,
          server_paused: false,
          notification_preferences: {},
        },
      };
    } else if (path.endsWith("/bot-state")) {
      result = { bots: [] };
    } else if (path.endsWith("/command-permissions")) {
      result = { permissions: [] };
    } else if (path.endsWith("/embeds")) {
      result = { jobs: [] };
    } else if (path.endsWith("/commerce/orders")) {
      if (path.includes(first)) {
        requestedResolve();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      result = {
        orders: [
          {
            orderId: path.includes(first) ? "RP-OLD111" : "RP-NEW222",
            buyerId: first,
            serviceName: "Guild scoped service",
            amountMinor: 70000,
            method: "upi",
            status: "claimed",
            createdAt: new Date().toISOString(),
            proofRef: "upi:123456789012",
          },
        ],
      };
    } else {
      throw new Error(`Unexpected API ${path}`);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Fleet controls", exact: true }).click();
  await Promise.race([
    requested,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Commerce request not issued")), 5000),
    ),
  ]);
  await page
    .getByRole("combobox", { name: "Choose server" })
    .selectOption(second);
  await page.getByRole("button", { name: "Fleet controls", exact: true }).click();
  await expect(page.getByRole("heading", { name: "RP-NEW222", exact: true })).toBeVisible();
  release();
  await page.waitForTimeout(250);
  expect(await page.getByRole("heading", { name: "RP-OLD111", exact: true }).count()).toBe(0);
  expect(await page.getByRole("heading", { name: "RP-NEW222", exact: true }).count()).toBe(1);
  expect(errors).toEqual([]);
});

test("checkout validates inputs, shows the QR, submits proof and reflects status", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const creates: Array<Record<string, unknown>> = [];
  const claims: Array<Record<string, unknown>> = [];
  let status = "claimed";
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "123456789012345678", name: "QA buyer" },
        isAdmin: false,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    });
  });
  await page.route("**/api/auth/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "qa-csrf" }),
    });
  });
  await page.route("**/api/payments/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let result: Record<string, unknown>;
    if (path.endsWith("/resume")) {
      result = { resumed: false };
    } else if (path.endsWith("/options")) {
      result = { enabled: true, methods: { upi: true, usdt: true } };
    } else if (path.endsWith("/upi-qr")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      creates.push(body);
      expect(request.headers()["x-csrf-token"]).toBe("qa-csrf");
      expect(body.discordId).toBeUndefined();
      expect(body.referralCode).toBe("ABC234");
      expect(body.idempotencyKey).toBeTruthy();
      expect(body.amount).toBeUndefined();
      result = {
        orderId: "RP-ABC123",
        token: "q".repeat(43),
        amountMinor: 123400,
        currency: "INR",
        paymentMethod: "upi",
        paymentUri:
          "upi://pay?pa=studio%40bank&pn=Studio&am=1234.00&cu=INR&tn=RP-ABC123",
        destination: "studio@bank",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        referralApplied: true,
      };
      if (body.paymentMethod === "usdt") {
        result = {
          ...result,
          amountMinor: 900,
          currency: "USDT",
          paymentMethod: "usdt",
          paymentUri: `T${"A".repeat(33)}`,
          destination: `T${"A".repeat(33)}`,
          network: "TRC-20 (Tron)",
        };
      }
    } else if (path.endsWith("/claim")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      claims.push(body);
      expect(request.headers()["x-csrf-token"]).toBe("qa-csrf");
      expect(body.token).toBe("q".repeat(43));
      if (body.utr !== undefined) expect(body.utr).toBe("123456789012");
      else expect(body.txid).toBe("a".repeat(64));
      result = { orderId: "RP-ABC123", status: "claimed", notificationStatus: "disabled" };
    } else if (path.endsWith("/status/RP-ABC123")) {
      result = {
        orderId: "RP-ABC123",
        status,
        amount: "1234.00",
        currency: "INR",
        serviceName: "QA service",
      };
    } else {
      throw new Error(`Unexpected API ${path}`);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/services?ref=ABC234");
  const button = page.getByRole("button", { name: "Checkout" }).first();
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Ordering as QA buyer")).toBeVisible();
  expect(await page.getByLabel("Referral code").inputValue()).toBe("ABC234");
  await page.getByRole("button", { name: "Show payment instructions" }).click();
  await expect(page.locator(".ei-checkout-qr")).toBeVisible();
  expect(
    await page
      .locator(".ei-checkout-qr")
      .evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth === 256 &&
          element.src.startsWith("data:image/png;base64,"),
      ),
  ).toBe(true);
  expect(await dialog.innerText()).toMatch(/1,?234\.00/);
  expect(await page.evaluate(() => localStorage.getItem("royal-referral-code"))).toBeNull();
  await page.getByLabel("12-digit UPI transaction ID (UTR)").fill("123");
  await page.getByRole("button", { name: "I’ve paid · submit proof" }).click();
  expect(claims.length).toBe(0);
  expect(
    await page
      .getByLabel("12-digit UPI transaction ID (UTR)")
      .evaluate((element) => (element as HTMLInputElement).validity.patternMismatch),
  ).toBe(true);
  await page.getByLabel("12-digit UPI transaction ID (UTR)").fill("123456789012");
  await page.getByRole("button", { name: "I’ve paid · submit proof" }).click();
  await expect(page.getByText(/Awaiting manual staff verification/)).toBeVisible();
  expect(claims.length).toBe(1);
  expect(
    await page.getByRole("link", { name: "Open verification page" }).getAttribute("href"),
  ).toBe("/verify?id=RP-ABC123");
  status = "confirmed";
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByText("Payment received and verified.")).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await fitsViewport(page)).toBe(true);
    expect(
      await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await button.evaluate((element) => element === document.activeElement)).toBe(true);
  expect(creates.length).toBe(1);
  await page.goto("/services?ref=ABC234");
  await page.getByRole("button", { name: "Checkout" }).first().click();
  await expect(page.getByText("Ordering as QA buyer")).toBeVisible();
  await page.getByLabel("Payment method").selectOption("usdt");
  await page.getByRole("button", { name: "Show payment instructions" }).click();
  await page.getByLabel("64-character TRON transaction hash").waitFor();
  await page.getByLabel("64-character TRON transaction hash").fill("short");
  await page.getByRole("button", { name: "I’ve paid · submit proof" }).click();
  expect(claims.length).toBe(1);
  await page.getByLabel("64-character TRON transaction hash").fill("a".repeat(64));
  await page.getByRole("button", { name: "I’ve paid · submit proof" }).click();
  await expect(page.getByText(/Awaiting manual staff verification/)).toBeVisible();
  expect(claims.length).toBe(2);
  expect(errors).toEqual([]);
});

test("razorpay checkout pays on the hosted page and claims with a staff-verifiable reference", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const orderPosts: Array<Record<string, unknown>> = [];
  const orderCsrf: string[] = [];
  const claimPosts: Array<Record<string, unknown>> = [];
  const claimCsrf: string[] = [];
  const pageUrl = "https://razorpay.me/@subrodluffy";
  const resumedToken = "r".repeat(43);
  let resumePayload: Record<string, unknown> | { resumed: false } = { resumed: false };
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "123456789012345678", name: "QA buyer" },
        isAdmin: false,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    });
  });
  await page.route("**/api/auth/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "qa-csrf" }),
    });
  });
  await page.route("**/api/payments/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let result: Record<string, unknown>;
    if (path.endsWith("/resume")) {
      result = resumePayload as Record<string, unknown>;
    } else if (path.endsWith("/options")) {
      result = { enabled: true, methods: { upi: true, usdt: true, razorpay: true } };
    } else if (path.endsWith("/upi-qr")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      orderPosts.push(body);
      orderCsrf.push(request.headers()["x-csrf-token"] ?? "");
      expect(body.amount).toBeUndefined();
      expect(body.paymentMethod).toBe("razorpay");
      expect(String(body.recoveryToken)).toHaveLength(43);
      result = {
        orderId: "RP-RZP111",
        token: String(body.recoveryToken),
        amountMinor: 70000,
        currency: "INR",
        paymentMethod: "razorpay",
        paymentUri: pageUrl,
        destination: pageUrl,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        referralApplied: false,
      };
    } else if (path.endsWith("/claim")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      claimPosts.push(body);
      claimCsrf.push(request.headers()["x-csrf-token"] ?? "");
      result = { orderId: "RP-RZP111", status: "claimed" };
    } else {
      throw new Error(`Unexpected API ${path}`);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/services");
  await page.getByRole("button", { name: "Checkout" }).first().click();
  await page.getByText("Ordering as QA buyer").waitFor();
  await page.getByLabel("Payment method").selectOption("razorpay");
  await page.getByRole("button", { name: "Show payment instructions" }).click();
  await expect(page.locator(".ei-checkout-qr")).toBeVisible();
  const pageLink = page.getByRole("link", { name: /Open Razorpay page/ });
  await expect(pageLink).toHaveAttribute("href", pageUrl);
  await expect(page.getByText("Payment page", { exact: true })).toBeVisible();
  expect(orderPosts.length).toBe(1);
  expect(orderCsrf[0]).toBe("qa-csrf");
  const qrSrc = await page.locator(".ei-checkout-qr").getAttribute("src");
  expect(String(qrSrc).startsWith("data:image/png")).toBe(true);
  const reference = page.getByLabel("Razorpay payment ID or UTR");
  await reference.fill("pay_QAZFRESH1");
  await page.getByRole("button", { name: "I’ve paid · submit proof" }).click();
  await expect(page.getByText(/Awaiting manual staff verification/)).toBeVisible();
  expect(claimPosts).toEqual([
    expect.objectContaining({ orderId: "RP-RZP111", reference: "pay_QAZFRESH1" }),
  ]);
  expect(claimCsrf[0]).toBe("qa-csrf");
  expect(claimPosts[0]?.utr).toBeUndefined();
  await page.keyboard.press("Escape");
  resumePayload = {
    resumed: true,
    orderId: "RP-RZP222",
    token: resumedToken,
    amountMinor: 70000,
    currency: "INR",
    paymentMethod: "razorpay",
    paymentUri: pageUrl,
    destination: pageUrl,
    status: "pending",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    referralApplied: true,
  };
  await page.goto("/services");
  await page.getByRole("button", { name: "Checkout" }).first().click();
  await expect(page.getByRole("link", { name: /Open Razorpay page/ })).toBeVisible();
  await expect(page.locator(".ei-checkout-qr")).toBeVisible();
  expect(orderPosts.length).toBe(1, "resuming must not create a second order");
  expect(errors).toEqual([]);
});
