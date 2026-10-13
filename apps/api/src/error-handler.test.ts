import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";

const secret = "test-only-secret-with-at-least-32-characters";
const env = { SESSION_SECRET: secret, CSRF_SECRET: secret };

test("error handler maps thrown numeric statusCode to request-denied", async () => {
  const app = createApp({ env, query: async () => [] });
  app.get("/boom", async () => {
    throw Object.assign(new Error("denied"), { statusCode: 400 });
  });
  const r = await app.inject("/boom");
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().code, "request-denied");
  await app.close();
});

test("error handler maps unknown throws to 503 without crashing", async () => {
  const app = createApp({ env, query: async () => [] });
  app.get("/weird", async () => {
    throw "string-throw";
  });
  const r = await app.inject("/weird");
  assert.equal(r.statusCode, 503);
  assert.equal(r.json().code, "service-unavailable");
  await app.close();
});
