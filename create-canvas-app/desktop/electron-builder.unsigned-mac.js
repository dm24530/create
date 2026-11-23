const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const build = require("./package.json").build;

function verifyAdHocSignature(context) {
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const codeResources = path.join(appPath, "Contents", "_CodeSignature", "CodeResources");
  if (!existsSync(codeResources)) {
    throw new Error(`macOS ad-hoc signature is missing: ${codeResources}`);
  }
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`[unsigned-mac] verified ad-hoc signature: ${appPath}`);
}

module.exports = {
  ...build,
  mac: {
    ...build.mac,
    identity: "-",
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
  },
  afterSign: verifyAdHocSignature,
};
