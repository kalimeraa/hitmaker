const LogEntry = require("../Models/LogEntry");

class LogRepository {
  create(payload) {
    return LogEntry.create(payload);
  }

  findRecent({ level, limit }) {
    const query = level ? { level } : {};
    return LogEntry.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 200, 500))
      .lean();
  }
}

module.exports = new LogRepository();
