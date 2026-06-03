const { cloakBrowser } = require("../config");

const DEFAULT_VIEWPORT = { width: 1280, height: 900 };
const DEFAULT_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage"
];

async function loadCloakBrowser() {
  return import("cloakbrowser");
}

function buildLaunchOptions({ headless, proxyUrl }) {
  return {
    headless,
    proxy: proxyUrl || undefined,
    args: DEFAULT_CHROMIUM_ARGS,
    locale: cloakBrowser.locale,
    timezone: cloakBrowser.timezone,
    geoip: cloakBrowser.geoip && Boolean(proxyUrl),
    humanize: cloakBrowser.humanize,
    humanPreset: cloakBrowser.humanPreset,
    viewport: DEFAULT_VIEWPORT
  };
}

async function launchBrowserContext(options) {
  const { launchContext } = await loadCloakBrowser();
  return launchContext(buildLaunchOptions(options));
}

module.exports = {
  DEFAULT_VIEWPORT,
  launchBrowserContext
};
