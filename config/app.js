require("dotenv").config();

function optionalBoolean(value) {
  if (typeof value === "undefined" || value === "") return undefined;
  return String(value).toLowerCase() === "true";
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/hitmaker",
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null
  },
  queueName: process.env.QUEUE_NAME || "browser-tasks",
  maxParallelBrowsers: Number(process.env.MAX_PARALLEL_BROWSERS || 4),
  taskTimeoutMs: Number(process.env.TASK_TIMEOUT_MS || 120000),
  cloakBrowser: {
    locale: process.env.CLOAKBROWSER_LOCALE || undefined,
    timezone: process.env.CLOAKBROWSER_TIMEZONE || undefined,
    geoip: optionalBoolean(process.env.CLOAKBROWSER_GEOIP) ?? true,
    humanize: optionalBoolean(process.env.CLOAKBROWSER_HUMANIZE) ?? true,
    humanPreset: process.env.CLOAKBROWSER_HUMAN_PRESET || "default"
  }
};
