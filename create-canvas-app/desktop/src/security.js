const path = require("node:path");

const APP_ORIGIN = "app://create";
const PARTITION = "persist:create-canvas";

function secureWindowOptions(preload) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    partition: PARTITION,
  };
}

function isTrustedAppUrl(candidate) {
  try {
    const url = new URL(candidate);
    return url.protocol === "app:" && url.hostname === "create";
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(candidate) {
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function resolveAppAssetPath(root, requestUrl) {
  const base = path.resolve(root);
  const url = new URL(requestUrl);
  const decoded = decodeURIComponent(url.pathname || "/");
  const requested = decoded === "/" ? "/index.html" : decoded;
  const candidate = path.resolve(base, `.${requested}`);
  if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) {
    throw new Error("path escapes app root");
  }
  return candidate;
}

module.exports = {
  APP_ORIGIN,
  PARTITION,
  isAllowedExternalUrl,
  isTrustedAppUrl,
  resolveAppAssetPath,
  secureWindowOptions,
};
