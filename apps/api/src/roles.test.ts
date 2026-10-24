import { test } from "node:test";
import assert from "node:assert/strict";
import { Roles } from "./roles.js";
import { resolvePreview } from "./roles.js";
import { DEFAULT_ADMIN_IDS, DEFAULT_MASTER_IDS } from "@ei-point/contracts";

const ADMIN = DEFAULT_ADMIN_IDS[0];
const MASTER = DEFAULT_MASTER_IDS[0];
const STRANGER = "999999999999999999";

test("the founding identities hold their roles by default", () => {
  const roles = new Roles({});
  assert.equal(roles.role(MASTER), "master");
  assert.equal(roles.role(ADMIN), "admin");
  assert.equal(roles.role(STRANGER), "user");
});

test("the master outranks the administrator", () => {
  const roles = new Roles({});
  assert.equal(roles.isMaster(MASTER), true);
  assert.equal(roles.isAdmin(MASTER), true);
  assert.equal(roles.isMaster(ADMIN), false);
  assert.equal(roles.isAdmin(ADMIN), true);
});

test("configuration overrides the defaults", () => {
  const roles = new Roles({
    DASHBOARD_ADMIN_IDS: "123456789012345678",
    DASHBOARD_MASTER_IDS: "234567890123456789",
  });
  assert.equal(roles.role("123456789012345678"), "admin");
  assert.equal(roles.role("234567890123456789"), "master");
  assert.equal(roles.role(ADMIN), "user");
  assert.equal(roles.role(MASTER), "user");
});

test("a malformed or empty list falls back to the defaults", () => {
  const roles = new Roles({
    DASHBOARD_ADMIN_IDS: "not-an-id, ,also-not",
    DASHBOARD_MASTER_IDS: "",
  });
  assert.equal(roles.role(ADMIN), "admin");
  assert.equal(roles.role(MASTER), "master");
});

test("a list of several identities is honoured", () => {
  const roles = new Roles({
    DASHBOARD_ADMIN_IDS: `${ADMIN},123456789012345678`,
  });
  assert.equal(roles.role(ADMIN), "admin");
  assert.equal(roles.role("123456789012345678"), "admin");
  assert.equal(roles.role(STRANGER), "user");
});

test("only the master can preview, and only downwards", () => {
  assert.equal(resolvePreview("master", "admin"), "admin");
  assert.equal(resolvePreview("master", "user"), "user");
  assert.equal(resolvePreview("master", "master"), null);
  assert.equal(resolvePreview("master", "owner"), null);
  assert.equal(resolvePreview("master", undefined), null);
  assert.equal(resolvePreview("admin", "user"), null);
  assert.equal(resolvePreview("user", "admin"), null);
});
