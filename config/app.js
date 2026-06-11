require("dotenv").config();
const path = require("path");

function optionalBoolean(value) {
  if (typeof value === "undefined" || value === "") return undefined;
  return String(value).toLowerCase() === "true";
}

const cloakBrowserPersistentProfile = optionalBoolean(process.env.CLOAKBROWSER_PERSISTENT_PROFILE) ?? true;
const maxTaskTimeoutMs = 60000;
const configuredTaskTimeoutMs = Number(process.env.TASK_TIMEOUT_MS || maxTaskTimeoutMs);

function buildMongoUri() {
  return process.env.MONGODB_URI
    || process.env.MONGO_URL
    || process.env.MONGO_PRIVATE_URL
    || "mongodb://localhost:27017/hitmaker";
}

function buildRedisConfig() {
  if (process.env.REDIS_URL) {
    const redisUrl = new URL(process.env.REDIS_URL);

    return {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
      password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
      tls: redisUrl.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null
    };
  }

  return {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null
  };
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
