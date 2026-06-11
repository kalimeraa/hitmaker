const { maxParallelBrowsers } = require("../../config/app");
const taskRepository = require("../Repositories/taskRepository");
const taskRunService = require("./taskRunService");
const { mapWithConcurrency } = require("../Utils/concurrency");
const { buildQueuedRuns, resolveFinalTaskStatus } = require("../Domain/taskRunPlanner");
const realtimeEventService = require("./realtimeEventService");
const taskCancellationService = require("./taskCancellationService");
const { logger } = require("./logService");

class TaskProcessorService {
  constructor(repository = taskRepository, runService = taskRunService, cancellationService = taskCancellationService) {
    this.repository = repository;
    this.runService = runService;
    this.cancellationService = cancellationService;
  }

  async process(job) {
    if (job.name === "retry-run") {
      return this.retryRun(job);
    }

    const task = await this.repository.findById(job.data.taskId);
    if (!task) throw new Error(`Task not found: ${job.data.taskId}`);
    await this.cancellationService.assertNotCancelled(task._id);

    await this.repository.startProcessing(task._id, buildQueuedRuns(task.keywords, task.count, {
      durationHours: task.durationHours,
      startsAt: new Date()
    }));
    await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "processing_started" });
    const startedTask = await this.repository.findById(task._id);
    if (!startedTask) return { taskId: String(task._id), status: "deleted" };

    const taskConcurrency = Math.max(1, Number(startedTask.maxConcurrentBrowsers || 2));
    const concurrency = Math.min(taskConcurrency, Math.max(2, Number(maxParallelBrowsers) || 2));
    logger.info("task_processing_concurrency_resolved", {
      taskId: String(startedTask._id),
      requestedConcurrency: taskConcurrency,
      maxParallelBrowsers,
      concurrency
    });

    await mapWithConcurrency(startedTask.runs, concurrency, async (run, index) => {
      await this.runService.run(startedTask, run, index);
      await this.runService.updateJobProgress(startedTask._id, job);
    });

    const finished = await this.repository.findById(startedTask._id);
    if (!finished) return { taskId: String(startedTask._id), status: "deleted" };
    finished.status = resolveFinalTaskStatus(finished.runs);
    await finished.save();
    await realtimeEventService.publish("task.updated", { taskId: String(startedTask._id), action: "finished" });

    return { taskId: String(startedTask._id), status: finished.status };
  }

  async markFailed(taskId, error) {
    await this.repository.markFailed(taskId, error);
    await realtimeEventService.publish("task.updated", { taskId: String(taskId), action: "failed" });
  }

  async retryRun(job) {
    const task = await this.repository.findById(job.data.taskId);
    if (!task) return { taskId: String(job.data.taskId), status: "deleted" };

    await this.cancellationService.assertNotCancelled(task._id);
    const runIndex = Number(job.data.runIndex);
    const run = task.runs && task.runs[runIndex];
    if (!run) throw new Error(`Run not found: ${job.data.taskId}:${runIndex}`);

    await this.runService.run(task, run, runIndex, {
      ignoreSchedule: true,
      incrementProgress: false
    });

    const finished = await this.repository.findById(task._id);
    if (!finished) return { taskId: String(task._id), status: "deleted" };

    finished.status = resolveFinalTaskStatus(finished.runs);
    await finished.save();
    await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_retry_finished", runIndex });
    return { taskId: String(task._id), runIndex, status: finished.status };
  }
}

module.exports = new TaskProcessorService();
