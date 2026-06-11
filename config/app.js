require("dotenv").config();
const path = require("path");

function optionalBoolean(value) {
  if (typeof value === "undefined" || value === "") return undefined;
  return String(value).toLowerCase() === "true";
}

const cloakBrowserPersistentProfile = optionalBoolean(process.env.CLOAKBROWSER_PERSISTENT_PROFILE) ?? true;
const maxTaskTimeoutMs = 60000;
const configuredTaskTimeoutMs = Number(process.env.TASK_TIMEOUT_MS || maxTaskTimeoutMs);
const isRailwayRuntime = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);

function buildMongoUri() {
  return process.env.MONGODB_URI
    || process.env.MONGO_URL
    || process.env.MONGO_PRIVATE_URL
    || "mongodb://localhost:27017/hitmaker";
}

function buildRedisConfig() {
  const redisConnectionUrl = process.env.REDIS_URL
    || process.env.REDIS_PRIVATE_URL
    || process.env.REDIS_PUBLIC_URL;

  if (redisConnectionUrl) {
    const redisUrl = new URL(redisConnectionUrl);

    return {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
      password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
      tls: redisUrl.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null
    };
  }

  const redisConfig = {
    host: process.env.REDIS_HOST || process.env.REDISHOST || "localhost",
    port: Number(process.env.REDIS_PORT || process.env.REDISPORT || 6379),
    username: process.env.REDIS_USERNAME || process.env.REDISUSER || undefined,
    password: process.env.REDIS_PASSWORD || process.env.REDISPASSWORD || undefined,
    maxRetriesPerRequest: null
  };

  if (isRailwayRuntime && ["localhost", "127.0.0.1", "::1"].includes(redisConfig.host)) {
    throw new Error("Railway Redis config missing. Set REDIS_URL or REDIS_PRIVATE_URL in Railway service variables.");
  }

  return redisConfig;
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  headlessDefault: optionalBoolean(process.env.HEADLESS_DEFAULT) ?? true,
  mongoUri: buildMongoUri(),
  redis: buildRedisConfig(),
  queueName: process.env.QUEUE_NAME || "browser-tasks",
  auth: {
    username: process.env.AUTH_USERNAME || "hitmaker",
    password: process.env.AUTH_PASSWORD || "hitmaker34716",
    jwtSecret: process.env.AUTH_JWT_SECRET || process.env.AUTH_COOKIE_SECRET || "hitmaker-local-panel-auth",
    jwtTtlSeconds: Number(process.env.AUTH_JWT_TTL_SECONDS || 60 * 60 * 12)
  },
  maxParallelBrowsers: Number(process.env.MAX_PARALLEL_BROWSERS || (cloakBrowserPersistentProfile ? 1 : 4)),
  taskTimeoutMs: Math.min(
    Number.isFinite(configuredTaskTimeoutMs) && configuredTaskTimeoutMs > 0 ? configuredTaskTimeoutMs : maxTaskTimeoutMs,
    maxTaskTimeoutMs
  ),
  googleMaxResultPages: Number(process.env.GOOGLE_MAX_RESULT_PAGES || 10),
  googleSearch: {
    hl: process.env.GOOGLE_SEARCH_HL || "tr",
    gl: process.env.GOOGLE_SEARCH_GL || "tr",
    pws: process.env.GOOGLE_SEARCH_PWS || "",
    udm: process.env.GOOGLE_SEARCH_UDM || ""
  },
  cloakBrowser: {
    locale: process.env.CLOAKBROWSER_LOCALE || undefined,
    timezone: process.env.CLOAKBROWSER_TIMEZONE || undefined,
    geoip: optionalBoolean(process.env.CLOAKBROWSER_GEOIP) ?? true,
    humanize: optionalBoolean(process.env.CLOAKBROWSER_HUMANIZE) ?? true,
    humanPreset: process.env.CLOAKBROWSER_HUMAN_PRESET || "default",
    persistentProfile: cloakBrowserPersistentProfile,
    userDataDir: process.env.CLOAKBROWSER_USER_DATA_DIR || path.join(__dirname, "..", "storage", "browser-profile")
  }
};
