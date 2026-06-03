const { browserQueue } = require("../../bootstrap/queue");

class TaskJobService {
  constructor(queue = browserQueue) {
    this.queue = queue;
  }

  enqueueTask(taskId) {
    return this.queue.add("search-click", { taskId: String(taskId) }, {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100
    });
  }

  enqueueRunRetry(taskId, runIndex) {
    return this.queue.add("retry-run", {
      taskId: String(taskId),
      runIndex: Number(runIndex)
    }, {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100
    });
  }

  async removeTaskJobs(taskId) {
    const jobs = await this.queue.getJobs(["waiting", "delayed", "prioritized", "paused"]);
    await Promise.all(jobs
      .filter((job) => String(job.data && job.data.taskId) === String(taskId))
      .map((job) => job.remove()));
  }
}

module.exports = new TaskJobService();
