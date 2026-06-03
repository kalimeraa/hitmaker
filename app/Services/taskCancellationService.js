const taskRepository = require("../Repositories/taskRepository");
const taskJobService = require("./taskJobService");
const { logger } = require("./logService");

class TaskCancellationService {
  constructor(repository = taskRepository, jobService = taskJobService) {
    this.repository = repository;
    this.jobService = jobService;
  }

  async cancel(taskId) {
    const task = await this.repository.cancel(taskId);
    if (!task) return null;

    await this.jobService.removeTaskJobs(taskId);
    logger.info("task_cancelled", { taskId: String(taskId) });
    return task;
  }

  async assertNotCancelled(taskId) {
    const task = await this.repository.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status === "cancelled") {
      throw new Error("Task cancelled");
    }
  }
}

module.exports = new TaskCancellationService();
