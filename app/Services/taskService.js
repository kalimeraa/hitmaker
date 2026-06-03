const taskRepository = require("../Repositories/taskRepository");
const taskJobService = require("./taskJobService");
const { validateCreateTaskPayload } = require("../Validators/taskValidator");

class TaskService {
  constructor(repository = taskRepository, jobService = taskJobService) {
    this.repository = repository;
    this.jobService = jobService;
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
}

module.exports = new TaskService();
