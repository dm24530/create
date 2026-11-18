import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function rewriteUpdateMetadata(source, releaseBaseUrl) {
  const base = String(releaseBaseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("releaseBaseUrl is required");

  function absolute(value) {
    const raw = String(value || "").trim();
    if (!raw) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${base}/${basename(raw)}`;
  }

  return source
    .replace(/^(\s*-\s*url:\s*)(.+)$/gm, (_line, prefix, value) => `${prefix}${absolute(value)}`)
    .replace(/^(\s*path:\s*)(.+)$/gm, (_line, prefix, value) => `${prefix}${absolute(value)}`);
}

export function buildUpdateSite({ outputDir, releaseBaseUrl, mappings }) {
  if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  for (const mapping of mappings) {
    const sourcePath = join(mapping.sourceDir, mapping.metadata);
    if (!existsSync(sourcePath)) throw new Error(`update metadata missing: ${sourcePath}`);
    const source = readFileSync(sourcePath, "utf8");
    const targetDir = join(outputDir, ...mapping.target.split("/"));
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, mapping.metadata), rewriteUpdateMetadata(source, releaseBaseUrl), "utf8");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const releaseBaseUrl = process.env.RELEASE_BASE_URL || "";
  const outputDir = resolve(root, process.env.UPDATE_SITE_DIR || "update-site");
  const mappings = [
    { target: "windows/x64", metadata: "latest.yml", sourceDir: resolve(root, process.env.WINDOWS_X64_DIR || "artifacts/windows-x64") },
    { target: "windows/arm64", metadata: "latest.yml", sourceDir: resolve(root, process.env.WINDOWS_ARM64_DIR || "artifacts/windows-arm64") },
    { target: "macos/arm64", metadata: "latest-mac.yml", sourceDir: resolve(root, process.env.MACOS_ARM64_DIR || "artifacts/macos-arm64") },
    { target: "macos/x64", metadata: "latest-mac.yml", sourceDir: resolve(root, process.env.MACOS_X64_DIR || "artifacts/macos-x64") },
  ];
  buildUpdateSite({ outputDir, releaseBaseUrl, mappings });
  console.log(`update site prepared at ${outputDir}`);
}