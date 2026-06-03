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

  completeRun(taskId, runIndex, payload) {
    const set = {};
    Object.entries(payload).forEach(([key, value]) => {
      set[`runs.${runIndex}.${key}`] = value;
    });
    return Task.updateOne({ _id: taskId }, { $set: set, $inc: { progress: 1 } });
  }

  markFailed(taskId, error) {
    return Task.findByIdAndUpdate(taskId, {
      status: "failed",
      error
    });
  }
}

module.exports = new TaskRepository();
