import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webVersionPath = resolve(appRoot, "web/VERSION");
const tag = process.env.GITHUB_REF_NAME || "";
const tagVersion = tag.startsWith("create-canvas-v") ? tag.slice("create-canvas-v".length) : "";
const version = String(process.argv[2] || tagVersion || readFileSync(webVersionPath, "utf8")).trim().replace(/^v/i, "");

if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) {
  throw new Error(`Invalid app version: ${version}`);
}

writeFileSync(webVersionPath, `v${version}\n`, "utf8");

const jsonTargets = [
  { path: "package.json" },
  { path: "web/package.json" },
  { path: "web/package-lock.json", lock: true },
  { path: "desktop/package.json" },
  { path: "desktop/package-lock.json", lock: true },
];

for (const target of jsonTargets) {
  const filePath = resolve(appRoot, target.path);
  const json = JSON.parse(readFileSync(filePath, "utf8"));
  json.version = version;
  if (target.lock && json.packages?.[""]) json.packages[""].version = version;
  writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

console.log(`Create app version synced to ${version}`);
