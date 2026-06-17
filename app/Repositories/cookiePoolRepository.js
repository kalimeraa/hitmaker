const CookiePoolItem = require("../Models/CookiePoolItem");

class CookiePoolRepository {
  findRecent(limit = 200) {
    return CookiePoolItem.find().sort({ createdAt: -1 }).limit(limit).lean();
  }

  findActive(limit = 200) {
    return CookiePoolItem.find({ status: "active", "cookies.0": { $exists: true } }).sort({ createdAt: 1 }).limit(limit).lean();
  }

  findById(id) {
    return CookiePoolItem.findById(id);
  }

  createMany(items) {
    if (!items.length) return [];
    return CookiePoolItem.insertMany(items);
  }

  create(item) {
    return CookiePoolItem.create(item);
  }

  updateDetails(id, payload) {
    return CookiePoolItem.findByIdAndUpdate(id, {
      $set: {
        name: payload.name,
        notes: payload.notes
      }
    }, { new: true }).lean();
  }

  updateStatus(id, status, reason = "") {
    return CookiePoolItem.findByIdAndUpdate(id, {
      $set: {
        status,
        disabledReason: reason
      }
    }, { new: true }).lean();
  }

  markUsed(id, payload) {
    return CookiePoolItem.findByIdAndUpdate(id, {
      $set: {
        lastUsedAt: new Date(),
        lastTaskId: payload.taskId,
        lastRunIndex: payload.runIndex,
        lastExitIp: payload.exitIp || ""
      }
    }, { new: true }).lean();
  }

  markBroken(id, reason) {
    return CookiePoolItem.findByIdAndUpdate(id, {
      $set: {
        status: "broken",
        disabledReason: reason,
        lastFailureAt: new Date()
      },
      $inc: { failureCount: 1 }
    }, { new: true }).lean();
  }

  deleteById(id) {
    return CookiePoolItem.findByIdAndDelete(id).lean();
  }
}

module.exports = new CookiePoolRepository();
