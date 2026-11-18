const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  isAllowedExternalUrl,
  isTrustedAppUrl,
  isTrustedRuntimeUrl,
  resolveAppAssetPath,
  secureWindowOptions,
} = require("../src/security");

test("desktop window keeps Chromium isolated and persistent", () => {
  const options = secureWindowOptions("/tmp/preload.js");
  assert.equal(options.contextIsolation, true);
  assert.equal(options.nodeIntegration, false);
  assert.equal(options.sandbox, true);
  assert.equal(options.webSecurity, true);
  assert.equal(options.partition, "persist:create-canvas");
});

test("only the local app origin is trusted for navigation", () => {
  assert.equal(isTrustedAppUrl("app://create/canvas"), true);
  assert.equal(isTrustedAppUrl("https://create.superai.sbs/canvas"), false);
  assert.equal(isTrustedAppUrl("app://create.evil.example/canvas"), false);
});

test("development App origin is trusted for reloads and navigation", () => {
  assert.equal(isTrustedRuntimeUrl("http://127.0.0.1:3001/login", "http://127.0.0.1:3001"), true);
  assert.equal(isTrustedRuntimeUrl("http://127.0.0.1:3001/image", "http://127.0.0.1:3001"), true);
  assert.equal(isTrustedRuntimeUrl("https://evil.example.com", "http://127.0.0.1:3001"), false);
  assert.equal(isTrustedRuntimeUrl("app://create/image", "http://127.0.0.1:3001"), true);
});

test("external navigation is limited to HTTP(S)", () => {
  assert.equal(isAllowedExternalUrl("https://example.com"), true);
  assert.equal(isAllowedExternalUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
});

test("asset resolution stays within the packaged web root", () => {
  const root = path.resolve("create-desktop-test-root", "web-dist");
  assert.equal(resolveAppAssetPath(root, "app://create/assets/app.js"), path.join(root, "assets", "app.js"));
  assert.throws(() => resolveAppAssetPath(root, "app://create/%2e%2e%2fsecret.txt"));
});


