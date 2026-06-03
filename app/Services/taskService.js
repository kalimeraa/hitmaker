const taskRepository = require("../Repositories/taskRepository");
const taskCancellationService = require("./taskCancellationService");
const taskJobService = require("./taskJobService");
const realtimeEventService = require("./realtimeEventService");
const { validateCreateTaskPayload } = require("../Validators/taskValidator");

class TaskService {
  constructor(repository = taskRepository, jobService = taskJobService, cancellationService = taskCancellationService) {
    this.repository = repository;
    this.jobService = jobService;
    this.cancellationService = cancellationService;
  }

  listTasks() {
    return this.repository.findRecent(50);
  }

  async getTask(id) {
    return this.repository.findLeanById(id);
  }

  async createTask(payload) {
    const taskPayload = validateCreateTaskPayload(payload);
    const task = await this.repository.create({
      ...taskPayload,
      status: "queued"
    });

    const job = await this.jobService.enqueueTask(task._id);
    await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "created" });

    return { ...task.toObject(), jobId: job.id };
  }

  async retryRun(taskId, runIndex) {
    const task = await this.repository.findLeanById(taskId);
    if (!task) return null;

    const index = Number(runIndex);
    const run = task.runs && task.runs[index];
    if (!run) return null;
    if (run.status === "clicked" || run.status === "running") {
      return { task, skipped: true };
    }

    await this.repository.prepareRunRetry(taskId, index);
    const job = await this.jobService.enqueueRunRetry(taskId, index);
    await realtimeEventService.publish("task.updated", { taskId: String(taskId), action: "run_retry_queued", runIndex: index });
    return { taskId: String(taskId), runIndex: index, jobId: job.id };
  }

  cancelTask(id) {
    return this.cancellationService.cancel(id);
  }
}

module.exports = new TaskService();
