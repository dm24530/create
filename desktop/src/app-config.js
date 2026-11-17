const APP_WEB_URL = "https://create.superai.sbs";

function resolveWebUrl({ isPackaged, env = process.env }) {
  if (isPackaged) return APP_WEB_URL;
  return env.CREATE_WEB_URL || APP_WEB_URL;
}

function isTrustedAppUrl(candidate, webUrl = APP_WEB_URL) {
  try {
    return new URL(candidate).origin === new URL(webUrl).origin;
  } catch {
    return false;
  }
}

module.exports = {
  APP_WEB_URL,
  isTrustedAppUrl,
  resolveWebUrl,
};
