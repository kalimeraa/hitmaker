const { maxParallelBrowsers } = require("../../config/app");
const taskRepository = require("../Repositories/taskRepository");
const taskRunService = require("./taskRunService");
const { mapWithConcurrency } = require("../Utils/concurrency");
const { buildQueuedRuns, resolveFinalTaskStatus } = require("../Domain/taskRunPlanner");

class TaskProcessorService {
  constructor(repository = taskRepository, runService = taskRunService) {
    this.repository = repository;
    this.runService = runService;
  }

  async process(job) {
    const task = await this.repository.findById(job.data.taskId);
    if (!task) throw new Error(`Task not found: ${job.data.taskId}`);

    await this.repository.startProcessing(task._id, buildQueuedRuns(task.keywords, task.count, {
      durationHours: task.durationHours,
      startsAt: new Date()
    }));
    const startedTask = await this.repository.findById(task._id);

    await mapWithConcurrency(startedTask.runs, maxParallelBrowsers, async (run, index) => {
      await this.runService.run(startedTask, run, index);
      await this.runService.updateJobProgress(startedTask._id, job);
    });

    const finished = await this.repository.findById(startedTask._id);
    finished.status = resolveFinalTaskStatus(finished.runs);
    await finished.save();

    return { taskId: String(startedTask._id), status: finished.status };
  }

  markFailed(taskId, error) {
    return this.repository.markFailed(taskId, error);
  }
}

module.exports = new TaskProcessorService();
