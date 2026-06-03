const { listLogs } = require("../../Services/logService");

class LogController {
  async index(req, res) {
    const logs = await listLogs({
      level: req.query.level,
      limit: req.query.limit
    });
    res.json(logs);
  }

  async errors(req, res) {
    const logs = await listLogs({
      level: "error",
      limit: req.query.limit || 200
    });
    res.json(logs);
  }
}

module.exports = new LogController();
