const { cloakBrowser } = require("../../config/app");
const ProxyChain = require("proxy-chain");

const DEFAULT_VIEWPORT = { width: 800, height: 600 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MOBILE_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const DEFAULT_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage"
];

async function loadCloakBrowser() {
  return import("cloakbrowser");
}

function hasProxyCredentials(proxyUrl) {
  if (!proxyUrl) return false;

  try {
    return Boolean(new URL(proxyUrl).username);
  } catch (error) {
    return false;
  }
}

async function anonymizeProxyIfNeeded(proxyUrl) {
  if (!hasProxyCredentials(proxyUrl)) {
    return { proxyUrl, close: async () => {} };
  }

  const anonymizedProxyUrl = await ProxyChain.anonymizeProxy(proxyUrl);
  return {
    proxyUrl: anonymizedProxyUrl,
    close: async () => {
      await ProxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true).catch(() => {});
    }
  };
}

function buildLaunchOptions({ headless, proxyUrl, deviceMode = "desktop", proxyGeoip = true }) {
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
    launchOptions.userAgent = MOBILE_USER_AGENT;
    launchOptions.contextOptions = {
      isMobile: true,
      hasTouch: true,
      screen: MOBILE_VIEWPORT,
      deviceScaleFactor: 3
    };
  }

  if (proxyUrl) {
    launchOptions.proxy = proxyUrl;
    launchOptions.geoip = proxyGeoip && cloakBrowser.geoip;
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
  const proxy = await anonymizeProxyIfNeeded(options.proxyUrl);
  const launchOptions = buildLaunchOptions({
    ...options,
    proxyUrl: proxy.proxyUrl,
    proxyGeoip: proxy.proxyUrl === options.proxyUrl
  });
  let context;

  if (cloakBrowser.persistentProfile) {
    context = await launchPersistentContext({
      ...launchOptions,
      userDataDir: cloakBrowser.userDataDir
    });
  } else {
    context = await launchContext(launchOptions);
  }

  const closeContext = context.close.bind(context);
  context.close = async (...args) => {
    try {
      return await closeContext(...args);
    } finally {
      await proxy.close();
    }
  };

  return context;
}

module.exports = {
  DEFAULT_VIEWPORT,
  MOBILE_VIEWPORT,
  MOBILE_USER_AGENT,
  anonymizeProxyIfNeeded,
  buildLaunchOptions,
  launchBrowserContext
};
