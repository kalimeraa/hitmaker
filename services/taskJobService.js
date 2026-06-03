const { browserQueue } = require("../queue");

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
}

module.exports = new TaskJobService();
