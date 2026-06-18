const GmailCreatorJob = require("../Models/GmailCreatorJob");

class GmailCreatorJobRepository {
  findRecent(limit = 100) {
    return GmailCreatorJob.find().sort({ createdAt: -1 }).limit(limit);
  }

  findById(id) {
    return GmailCreatorJob.findById(id);
  }

  create(payload) {
    return GmailCreatorJob.create(payload);
  }

  update(id, payload) {
    return GmailCreatorJob.findByIdAndUpdate(id, payload, { new: true });
  }

  markRunning(id, payload = {}) {
    return this.update(id, { status: "running", startedAt: new Date(), ...payload });
  }

  markAwaitingManual(id, payload = {}) {
    return this.update(id, { status: "awaiting_manual", ...payload });
  }

  markCompleted(id, payload = {}) {
    return this.update(id, {
      status: "completed",
      completedAt: new Date(),
      failureReason: "",
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

  deleteById(id) {
    return GmailCreatorJob.findByIdAndDelete(id);
  }
}

module.exports = new GmailCreatorJobRepository();
