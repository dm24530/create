const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

async function loadModule() {
  return import("../../scripts/prepare-update-site.mjs");
}

test("rewrites relative update files to absolute GitHub release URLs", async () => {
  const { rewriteUpdateMetadata } = await loadModule();
  const source = [
    "version: 0.1.13",
    "files:",
    "  - url: Create-Setup-0.1.13-win-x64.exe",
    "    sha512: abc",
    "    size: 123",
    "path: Create-Setup-0.1.13-win-x64.exe",
    "sha512: abc",
    "releaseDate: '2026-11-18T00:00:00Z'",
    "",
  ].join("\n");

  const result = rewriteUpdateMetadata(
    source,
    "https://github.com/dm24530/create/releases/download/create-canvas-v0.1.13",
  );

  assert.match(result, /url: https:\/\/github\.com\/dm24530\/create\/releases\/download\/create-canvas-v0\.1\.13\/Create-Setup-0\.1\.13-win-x64\.exe/);
  assert.match(result, /path: https:\/\/github\.com\/dm24530\/create\/releases\/download\/create-canvas-v0\.1\.13\/Create-Setup-0\.1\.13-win-x64\.exe/);
});

test("builds architecture-specific update folders", async () => {
  const { buildUpdateSite } = await loadModule();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "create-update-site-"));
  const win = path.join(root, "win");
  const mac = path.join(root, "mac");
  fs.mkdirSync(win, { recursive: true });
  fs.mkdirSync(mac, { recursive: true });
  fs.writeFileSync(path.join(win, "latest.yml"), "files:\n  - url: setup.exe\npath: setup.exe\n");
  fs.writeFileSync(path.join(mac, "latest-mac.yml"), "files:\n  - url: update.zip\npath: update.zip\n");

  const output = path.join(root, "site");
  buildUpdateSite({
    outputDir: output,
    releaseBaseUrl: "https://example.com/releases/v1",
    mappings: [
      { target: "windows/x64", metadata: "latest.yml", sourceDir: win },
      { target: "macos/arm64", metadata: "latest-mac.yml", sourceDir: mac },
    ],
  });

  assert.match(fs.readFileSync(path.join(output, "windows/x64/latest.yml"), "utf8"), /https:\/\/example\.com\/releases\/v1\/setup\.exe/);
  assert.match(fs.readFileSync(path.join(output, "macos/arm64/latest-mac.yml"), "utf8"), /https:\/\/example\.com\/releases\/v1\/update\.zip/);
});