const { cloakBrowser } = require("../../config/app");

const DEFAULT_VIEWPORT = { width: 800, height: 600 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DEFAULT_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage"
];

async function loadCloakBrowser() {
  return import("cloakbrowser");
}

function buildLaunchOptions({ headless, proxyUrl, deviceMode = "desktop" }) {
  const isMobile = deviceMode === "mobile";
  const platformArgs = process.platform === "linux" ? DEFAULT_CHROMIUM_ARGS : [];
  const args = isMobile
    ? [...platformArgs, `--window-size=${MOBILE_VIEWPORT.width},${MOBILE_VIEWPORT.height}`]
    : (headless ? platformArgs : [...platformArgs, "--start-maximized"]);

  const launchOptions = {
    headless,
    humanize: cloakBrowser.humanize,
    viewport: isMobile ? MOBILE_VIEWPORT : (headless ? DEFAULT_VIEWPORT : null)
  };

  if (isMobile) {
    launchOptions.contextOptions = {
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3
    };
  }

  if (proxyUrl) {
    launchOptions.proxy = proxyUrl;
    launchOptions.geoip = cloakBrowser.geoip;
  }
  if (cloakBrowser.locale) {
    launchOptions.locale = cloakBrowser.locale;
  }
  if (cloakBrowser.timezone) {
    launchOptions.timezone = cloakBrowser.timezone;
  }
  if (cloakBrowser.humanPreset && cloakBrowser.humanPreset !== "default") {
    launchOptions.humanPreset = cloakBrowser.humanPreset;
  }
  if (args.length) {
    launchOptions.args = args;
  }

  return launchOptions;
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
  MOBILE_VIEWPORT,
  buildLaunchOptions,
  launchBrowserContext
};
