const assert = require("node:assert/strict");
const test = require("node:test");

const { APP_WEB_URL, isTrustedAppUrl, resolveWebUrl } = require("../src/app-config");

test("packaged builds ignore environment overrides", () => {
  assert.equal(resolveWebUrl({
    isPackaged: true,
    env: { CREATE_WEB_URL: "https://malicious.example.com" },
  }), APP_WEB_URL);
});

test("development builds may target a local server", () => {
  assert.equal(resolveWebUrl({
    isPackaged: false,
    env: { CREATE_WEB_URL: "http://127.0.0.1:9898" },
  }), "http://127.0.0.1:9898");
});

test("only the configured Create origin is trusted", () => {
  assert.equal(isTrustedAppUrl("https://create.superai.sbs/login"), true);
  assert.equal(isTrustedAppUrl("https://create.superai.sbs.evil.example/login"), false);
  assert.equal(isTrustedAppUrl("https://evil.example/login"), false);
});
