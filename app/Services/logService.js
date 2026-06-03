const winston = require("winston");
const logRepository = require("../Repositories/logRepository");
const realtimeEventService = require("./realtimeEventService");

class MongoLogTransport extends winston.Transport {
  constructor(repository = logRepository) {
    super();
    this.repository = repository;
  }

  log(info, callback) {
    setImmediate(() => this.emit("logged", info));

    const { level, message, service, ...meta } = info;
    this.repository.create({
      level,
      message,
      service: service || process.env.SERVICE_NAME || "app",
      meta
    }).then((log) => {
      realtimeEventService.publish("log.created", log.toObject()).catch(() => {});
    }).catch(() => {});

    callback();
  }
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: process.env.SERVICE_NAME || "app" },
  transports: [
    new winston.transports.Console(),
    new MongoLogTransport()
  ]
});

async function listLogs({ level, limit = 200 }) {
  return logRepository.findRecent({ level, limit });
}

module.exports = { logger, listLogs };
