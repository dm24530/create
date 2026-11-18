import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webVersionPath = resolve(appRoot, "web/VERSION");
const desktopPackagePath = resolve(appRoot, "desktop/package.json");
const desktopLockPath = resolve(appRoot, "desktop/package-lock.json");
const tag = process.env.GITHUB_REF_NAME || "";
const tagVersion = tag.startsWith("create-canvas-v") ? tag.slice("create-canvas-v".length) : "";
const version = String(process.argv[2] || tagVersion || readFileSync(webVersionPath, "utf8")).trim().replace(/^v/i, "");

if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) {
  throw new Error(`Invalid app version: ${version}`);
}

writeFileSync(webVersionPath, `v${version}\n`, "utf8");

const packageJson = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
packageJson.version = version;
writeFileSync(desktopPackagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

const lockJson = JSON.parse(readFileSync(desktopLockPath, "utf8"));
lockJson.version = version;
if (lockJson.packages?.[""]) lockJson.packages[""].version = version;
writeFileSync(desktopLockPath, `${JSON.stringify(lockJson, null, 2)}\n`, "utf8");

console.log(`Create app version synced to ${version}`);
