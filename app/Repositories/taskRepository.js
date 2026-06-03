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

  updateAndReset(taskId, payload) {
    return Task.findByIdAndUpdate(taskId, {
      $set: {
        ...payload,
        status: "queued",
        progress: 0,
        runs: [],
        error: ""
      },
      $inc: { runVersion: 1 }
    }, { new: true });
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

  startRunAttempt(taskId, runIndex) {
    return Task.updateOne({ _id: taskId }, {
      $set: {
        [`runs.${runIndex}.status`]: "running",
        [`runs.${runIndex}.startedAt`]: new Date()
      },
      $unset: {
        [`runs.${runIndex}.error`]: ""
      },
      $inc: {
        [`runs.${runIndex}.attempts`]: 1
      }
    });
  }

  appendRunCandidates(taskId, runIndex, candidates) {
    if (!candidates.length) return Promise.resolve();

    return Task.updateOne({ _id: taskId }, {
      $push: {
        [`runs.${runIndex}.candidates`]: {
          $each: candidates,
          $slice: -120
        }
      }
    });
  }

  prepareRunRetry(taskId, runIndex) {
    return Task.updateOne({ _id: taskId }, {
      $set: {
        status: "running",
        [`runs.${runIndex}.attempts`]: 0,
        [`runs.${runIndex}.status`]: "queued",
        [`runs.${runIndex}.scheduledAt`]: new Date()
      },
      $unset: {
        error: "",
        [`runs.${runIndex}.matchedUrl`]: "",
        [`runs.${runIndex}.resultPage`]: "",
        [`runs.${runIndex}.resultRank`]: "",
        [`runs.${runIndex}.error`]: "",
        [`runs.${runIndex}.searchUrl`]: "",
        [`runs.${runIndex}.lastGoogleUrl`]: "",
        [`runs.${runIndex}.googleBlocked`]: "",
        [`runs.${runIndex}.candidates`]: "",
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
