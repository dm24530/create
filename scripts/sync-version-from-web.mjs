import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

function syncPackageVersion(relativePath) {
  const filePath = resolve(appRoot, relativePath);
  if (!existsSync(filePath)) return;
  const packageJson = JSON.parse(readFileSync(filePath, "utf8"));
  packageJson.version = version;
  writeFileSync(filePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

function syncLockVersion(relativePath) {
  const filePath = resolve(appRoot, relativePath);
  if (!existsSync(filePath)) return;
  const lockJson = JSON.parse(readFileSync(filePath, "utf8"));
  lockJson.version = version;
  if (lockJson.packages?.[""]) lockJson.packages[""].version = version;
  writeFileSync(filePath, `${JSON.stringify(lockJson, null, 2)}\n`, "utf8");
}

writeFileSync(webVersionPath, `v${version}\n`, "utf8");
syncPackageVersion("package.json");
syncPackageVersion("web/package.json");
syncPackageVersion("desktop/package.json");
syncLockVersion("web/package-lock.json");
syncLockVersion("desktop/package-lock.json");

console.log(`Create app version synced to ${version}`);
