const MrLoginJob = require("../Models/MrLoginJob");

class MrLoginJobRepository {
  findRecent(limit = 20) {
    return MrLoginJob.find().sort({ createdAt: -1 }).limit(limit);
  }

  findById(id) {
    return MrLoginJob.findById(id);
  }

  create(payload) {
    return MrLoginJob.create(payload);
  }

  update(id, payload) {
    return MrLoginJob.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
  }

  markRunning(id, payload = {}) {
    return this.update(id, {
      status: "running",
      startedAt: new Date(),
      lastError: "",
      ...payload
    });
  }

  markCompleted(id, payload = {}) {
    return this.update(id, {
      status: "completed",
      completedAt: new Date(),
      lastError: "",
      ...payload
    });
  }

  markFailed(id, payload = {}) {
    return this.update(id, {
      status: "failed",
      completedAt: new Date(),
      ...payload
    });
  }

  submitEmailAuthCode(id, code) {
    return this.update(id, {
      emailAuthCode: String(code || "").trim(),
      emailAuthCodeSubmittedAt: new Date()
    });
  }

  appendLog(id, entry) {
    const update = {
      $push: {
        logs: {
          at: new Date(),
          event: entry.event || "",
          message: entry.message || "",
          meta: entry.meta || {}
        }
      }
    };
    if (entry.meta && entry.meta.url) {
      update.$set = { lastUrl: entry.meta.url };
    }
    return MrLoginJob.findByIdAndUpdate(id, update, { new: true });
  }
}

module.exports = new MrLoginJobRepository();
