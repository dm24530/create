import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expected = readFileSync(resolve(appRoot, "web/VERSION"), "utf8").trim().replace(/^v/i, "");
if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(expected)) throw new Error(`Invalid web/VERSION: ${expected}`);

const targets = [
  { path: "package.json" },
  { path: "web/package.json" },
  { path: "web/package-lock.json", lock: true },
  { path: "desktop/package.json" },
  { path: "desktop/package-lock.json", lock: true },
];
const mismatches = [];
for (const target of targets) {
  const json = JSON.parse(readFileSync(resolve(appRoot, target.path), "utf8"));
  if (json.version !== expected) mismatches.push(`${target.path}: ${json.version ?? "missing"} != ${expected}`);
  if (target.lock && json.packages?.[""]?.version !== expected) {
    mismatches.push(`${target.path} packages[""]: ${json.packages?.[""]?.version ?? "missing"} != ${expected}`);
  }
}
if (mismatches.length) {
  throw new Error(`App version metadata mismatch:\n${mismatches.join("\n")}`);
}
console.log(`App version metadata is consistent at ${expected}`);
