import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const argValue = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
};

const version = argValue("--version", process.env.RELEASE_VERSION || "").trim().replace(/^v/i, "");
const artifactsRoot = resolve(argValue("--artifacts", "artifacts"));
const outputRoot = resolve(argValue("--output", "release-output"));
const publicBase = argValue("--public-base", "https://download.superai.sbs/app-releases").replace(/\/+$/, "");

if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) throw new Error(`Invalid release version: ${version}`);
if (!existsSync(artifactsRoot)) throw new Error(`Artifacts directory not found: ${artifactsRoot}`);

const platforms = [
  { artifact: "windows-x64", os: "windows", arch: "x64", manifest: "latest.yml" },
  { artifact: "windows-arm64", os: "windows", arch: "arm64", manifest: "latest.yml" },
  { artifact: "macos-arm64", os: "macos", arch: "arm64", manifest: "latest-mac.yml" },
  { artifact: "macos-x64", os: "macos", arch: "x64", manifest: "latest-mac.yml" },
];

function walk(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function findManifest(platform) {
  const root = join(artifactsRoot, platform.artifact);
  const files = walk(root);
  return files.find((file) => basename(file) === platform.manifest)
    || files.find((file) => file.endsWith(".yml") && file.includes(platform.os))
    || files.find((file) => file.endsWith(".yml"));
}

function parseManifest(text) {
  const result = { version: "", releaseDate: "", files: [] };
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const versionMatch = line.match(/^version:\s*(.+)$/);
    if (versionMatch) result.version = versionMatch[1].trim();
    const dateMatch = line.match(/^releaseDate:\s*['"]?([^'"]+)['"]?\s*$/);
    if (dateMatch) result.releaseDate = dateMatch[1].trim();
    const urlMatch = line.match(/^\s*-\s+url:\s*(.+)$/);
    if (urlMatch) {
      current = { url: urlMatch[1].trim() };
      result.files.push(current);
      continue;
    }
    if (!current) continue;
    const shaMatch = line.match(/^\s+sha512:\s*(.+)$/);
    if (shaMatch) {
      current.sha512 = shaMatch[1].trim();
      continue;
    }
    const sizeMatch = line.match(/^\s+size:\s*(\d+)$/);
    if (sizeMatch) current.size = Number(sizeMatch[1]);
  }
  return result;
}

function normalizedFileName(platform, sourceName) {
  const lower = sourceName.toLowerCase();
  const prefix = platform.os === "windows" ? `Create-Setup-${version}-win-${platform.arch}` : `Create-${version}-mac-${platform.arch}`;
  if (lower.endsWith(".exe.blockmap")) return `${prefix}.exe.blockmap`;
  if (lower.endsWith(".exe")) return `${prefix}.exe`;
  if (lower.endsWith(".dmg")) return `${prefix}.dmg`;
  if (lower.endsWith(".zip")) return `${prefix}.zip`;
  return `${prefix}${extname(sourceName).toLowerCase()}`;
}

function findSourceFile(platform, manifestPath, manifestFile) {
  const directory = resolve(manifestPath, "..");
  const expected = basename(decodeURIComponent(manifestFile.url.split("?")[0]));
  const files = walk(join(artifactsRoot, platform.artifact));
  return files.find((file) => basename(file) === expected)
    || files.find((file) => file.endsWith(expected))
    || null;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const releaseDirectory = join(outputRoot, `v${version}`);
mkdirSync(releaseDirectory, { recursive: true });
const checksumLines = [];
const summary = [];

for (const platform of platforms) {
  const manifestPath = findManifest(platform);
  if (!manifestPath) throw new Error(`Missing ${platform.os} ${platform.arch} update manifest under ${join(artifactsRoot, platform.artifact)}`);
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  if (manifest.version && manifest.version !== version) {
    throw new Error(`${platform.artifact} manifest version ${manifest.version} does not match ${version}`);
  }
  const rewrittenFiles = [];
  for (const entry of manifest.files) {
    const source = findSourceFile(platform, manifestPath, entry);
    if (!source) throw new Error(`Missing artifact referenced by ${platform.artifact}: ${entry.url}`);
    const destinationName = normalizedFileName(platform, basename(source));
    const destination = join(releaseDirectory, destinationName);
    copyFileSync(source, destination);
    const publicUrl = `${publicBase}/v${version}/${destinationName}`;
    rewrittenFiles.push({ ...entry, url: publicUrl, size: entry.size || statSync(destination).size });
    checksumLines.push(`${sha256(destination)}  ${destinationName}`);
    summary.push({ platform: platform.artifact, file: destinationName, size: statSync(destination).size });
  }

  const primary = rewrittenFiles[0];
  const manifestDirectory = join(outputRoot, platform.os, platform.arch);
  mkdirSync(manifestDirectory, { recursive: true });
  const lines = [
    `version: ${version}`,
    "files:",
    ...rewrittenFiles.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512 || ""}`,
      `    size: ${file.size || 0}`,
    ]),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512 || ""}`,
    `releaseDate: '${manifest.releaseDate || new Date().toISOString()}'`,
    "",
  ];
  writeFileSync(join(manifestDirectory, platform.manifest), lines.join("\n"), "utf8");
}

checksumLines.sort();
writeFileSync(join(releaseDirectory, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");
writeFileSync(join(outputRoot, "release-summary.json"), `${JSON.stringify({ version, publicBase, files: summary }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ version, output: releaseDirectory, files: summary }, null, 2));