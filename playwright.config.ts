import { defineConfig } from "@playwright/test";

const dashboardPort = Number(process.env.EI_BROWSER_PORT ?? 3310);
// The dashboard bakes its /api rewrite (and several SSR fallbacks) to the
// default demo-api port 3001, so the suite serves the demo API there.
const apiPort = Number(process.env.EI_BROWSER_API_PORT ?? 3001);

export default defineConfig({
  testDir: "tests/browser",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${dashboardPort}`,
    channel: "msedge",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node apps/api/demo/demo-server.mjs",
      url: `http://127.0.0.1:${apiPort}/healthz`,
      env: { ...process.env, PORT: String(apiPort) },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @ei-point/dashboard exec next start -p ${dashboardPort}`,
      url: `http://127.0.0.1:${dashboardPort}`,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_BASE: `http://127.0.0.1:${apiPort}`,
        API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
        INTERNAL_SERVICE_TOKEN: "",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
