const Task = require("../Models/Task");

class TaskRepository {
  findRecent(limit = 50) {
    return Task.find().sort({ createdAt: -1 }).limit(limit).lean();
  }

  findById(id) {
    return Task.findById(id);
  }

  findLeanById(id) {
    return Task.findById(id).lean();
  }

  create(payload) {
    return Task.create(payload);
  }

  startProcessing(taskId, runs) {
    return Task.updateOne({ _id: taskId }, {
      $set: {
        status: "running",
        progress: 0,
        runs
      },
      $unset: { error: "" }
    });
  }

  updateRun(taskId, runIndex, payload) {
    const set = {};
    Object.entries(payload).forEach(([key, value]) => {
      set[`runs.${runIndex}.${key}`] = value;
    });
    return Task.updateOne({ _id: taskId }, { $set: set });
  }

  prepareRunRetry(taskId, runIndex) {
    return Task.updateOne({ _id: taskId }, {
      $set: {
        status: "running",
        [`runs.${runIndex}.status`]: "queued",
        [`runs.${runIndex}.scheduledAt`]: new Date()
      },
      $unset: {
        error: "",
        [`runs.${runIndex}.matchedUrl`]: "",
        [`runs.${runIndex}.resultPage`]: "",
        [`runs.${runIndex}.error`]: "",
        [`runs.${runIndex}.startedAt`]: "",
        [`runs.${runIndex}.finishedAt`]: ""
      }
    });
  }

  completeRun(taskId, runIndex, payload) {
    const set = {};
    Object.entries(payload).forEach(([key, value]) => {
      set[`runs.${runIndex}.${key}`] = value;
    });
    return Task.updateOne({ _id: taskId }, { $set: set, $inc: { progress: 1 } });
  }

  replaceRunResult(taskId, runIndex, payload) {
    const set = {};
    Object.entries(payload).forEach(([key, value]) => {
      set[`runs.${runIndex}.${key}`] = value;
    });
    return Task.updateOne({ _id: taskId }, { $set: set });
  }

  markFailed(taskId, error) {
    return Task.findByIdAndUpdate(taskId, {
      status: "failed",
      error
    });
  }

  cancel(taskId) {
    return Task.findByIdAndUpdate(taskId, {
      status: "cancelled",
      error: "Task cancelled"
    }, { new: true });
  }

  deleteById(taskId) {
    return Task.findByIdAndDelete(taskId).lean();
  }
}

module.exports = new TaskRepository();
