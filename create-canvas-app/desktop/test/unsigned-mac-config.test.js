const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = require("../package.json");
const unsignedConfig = require("../electron-builder.unsigned-mac.js");
const workflow = readFileSync(
  path.resolve(__dirname, "../../../.github/workflows/create-canvas-app.yml"),
  "utf8",
);

test("unsigned macOS config explicitly uses ad-hoc signing without hardened runtime", () => {
  assert.equal(unsignedConfig.mac.identity, "-");
  assert.equal(unsignedConfig.mac.hardenedRuntime, false);
  assert.equal(unsignedConfig.mac.gatekeeperAssess, false);
  assert.equal(unsignedConfig.mac.notarize, false);
  assert.equal(typeof unsignedConfig.afterSign, "function");
});
test("desktop provides unsigned ad-hoc builds for both macOS architectures", () => {
  assert.ok(packageJson.scripts["dist:mac:arm64:unsigned"]);
  assert.ok(packageJson.scripts["dist:mac:x64:unsigned"]);
});

test("macOS workflow selects the unsigned build when no certificate is configured", () => {
  assert.match(workflow, /dist:mac:\$\{\{ matrix\.arch \}\}:unsigned/);
  assert.match(workflow, /Signature=adhoc/);
  assert.match(workflow, /Contents\/_CodeSignature\/CodeResources/);
  assert.match(workflow, /codesign --verify --deep --strict/);
});
