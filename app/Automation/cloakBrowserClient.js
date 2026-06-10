const { cloakBrowser } = require("../../config/app");

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
  const args = headless
    ? DEFAULT_CHROMIUM_ARGS
    : [...DEFAULT_CHROMIUM_ARGS, "--start-maximized"];

  return {
    headless,
    proxy: proxyUrl || undefined,
    args,
    locale: cloakBrowser.locale,
    timezone: cloakBrowser.timezone,
    geoip: cloakBrowser.geoip && Boolean(proxyUrl),
    humanize: cloakBrowser.humanize,
    humanPreset: cloakBrowser.humanPreset,
    viewport: headless ? DEFAULT_VIEWPORT : null
  };
}

async function launchBrowserContext(options) {
  const { launchContext, launchPersistentContext } = await loadCloakBrowser();
  const launchOptions = buildLaunchOptions(options);

  if (cloakBrowser.persistentProfile) {
    return launchPersistentContext({
      ...launchOptions,
      userDataDir: cloakBrowser.userDataDir
    });
  }

  return launchContext(launchOptions);
}

module.exports = {
  DEFAULT_VIEWPORT,
  launchBrowserContext
};
