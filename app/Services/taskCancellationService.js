const taskRepository = require("../Repositories/taskRepository");
const taskJobService = require("./taskJobService");
const { logger } = require("./logService");
const realtimeEventService = require("./realtimeEventService");

class TaskCancellationService {
  constructor(repository = taskRepository, jobService = taskJobService) {
    this.repository = repository;
    this.jobService = jobService;
  }

  async cancel(taskId) {
    const task = await this.repository.deleteById(taskId);
    if (!task) return null;

    await this.jobService.removeTaskJobs(taskId);
    logger.info("task_deleted", { taskId: String(taskId) });
    await realtimeEventService.publish("task.deleted", { taskId: String(taskId) });
    return task;
  }

  async assertNotCancelled(taskId) {
    const task = await this.repository.findById(taskId);
    if (!task) throw new Error("Task cancelled");
    if (task.status === "cancelled") {
      throw new Error("Task cancelled");
    }
  }
}

module.exports = new TaskCancellationService();
