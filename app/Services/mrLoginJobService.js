const { browserQueue } = require("../../bootstrap/queue");

class MrLoginJobService {
  constructor(queue = browserQueue) {
    this.queue = queue;
  }

  enqueue(jobId) {
    return this.queue.add("mr-login", {
      type: "mr-login",
      jobId: String(jobId)
    }, {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100
    });
  }
}

module.exports = new MrLoginJobService();
