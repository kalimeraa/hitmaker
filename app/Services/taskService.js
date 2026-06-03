const taskRepository = require("../Repositories/taskRepository");
const taskCancellationService = require("./taskCancellationService");
const taskJobService = require("./taskJobService");
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

    return { ...task.toObject(), jobId: job.id };
  }

  cancelTask(id) {
    return this.cancellationService.cancel(id);
  }
}

module.exports = new TaskService();
