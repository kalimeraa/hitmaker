const { browserQueue } = require("../../bootstrap/queue");

class MrLoginJobService {
  constructor(queue = browserQueue) {
    this.queue = queue;
  }

  enqueue(jobId, options = {}) {
    return this.queue.add("mr-login", {
      type: "mr-login",
      jobId: String(jobId),
      mode: options.mode || "direct"
    }, {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100
    });
  }
}

module.exports = new MrLoginJobService();
