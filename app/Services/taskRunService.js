const taskRepository = require("../Repositories/taskRepository");
const { calculateProgressPercent } = require("../Domain/taskRunPlanner");
const { runGoogleSearchClick } = require("../Automation/googleClick");
const { taskTimeoutMs } = require("../../config/app");
const { logger } = require("./logService");
const taskCancellationService = require("./taskCancellationService");
const runScheduleService = require("./runScheduleService");

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Browser run timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

class TaskRunService {
  constructor(repository = taskRepository, browserAutomation = runGoogleSearchClick, scheduleService = runScheduleService, cancellationService = taskCancellationService) {
    this.repository = repository;
    this.browserAutomation = browserAutomation;
    this.scheduleService = scheduleService;
    this.cancellationService = cancellationService;
  }

  async run(task, run, index) {
    await this.scheduleService.waitUntil(run.scheduledAt);
    await this.cancellationService.assertNotCancelled(task._id);

    const logAutomationEvent = (event, meta = {}) => {
      logger.info(event, {
        taskId: String(task._id),
        runIndex: index,
        keyword: run.keyword,
        targetAddress: task.targetAddress,
        ...meta
      });
    };

    await this.repository.updateRun(task._id, index, {
      status: "running",
      startedAt: new Date()
    });
    logAutomationEvent("task_run_started");

    try {
      const result = await withTimeout(this.browserAutomation({
        keyword: run.keyword,
        targetAddress: task.targetAddress,
        headless: task.headless,
        proxyUrl: task.proxyUrl,
        cookies: task.cookies,
        onEvent: async (event, meta) => {
          logAutomationEvent(event, meta);
          await this.cancellationService.assertNotCancelled(task._id);
        },
        shouldCancel: async () => {
          const latest = await this.repository.findById(task._id);
          return !latest || latest.status === "cancelled";
        }
      }), taskTimeoutMs + 5000);

      await this.repository.completeRun(task._id, index, {
        status: result.status,
        matchedUrl: result.matchedUrl,
        resultPage: result.resultPage,
        finishedAt: new Date()
      });
      logAutomationEvent("task_run_completed", result);
    } catch (error) {
      await this.repository.completeRun(task._id, index, {
        status: "failed",
        error: error.message,
        finishedAt: new Date()
      });
      logAutomationEvent("task_run_failed", { error: error.message });
    }
  }

  async updateJobProgress(taskId, job) {
    const task = await this.repository.findById(taskId);
    await job.updateProgress(calculateProgressPercent(task.progress, task.count));
  }
}

module.exports = new TaskRunService();
