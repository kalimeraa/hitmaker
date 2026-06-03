const taskRepository = require("../Repositories/taskRepository");
const { calculateProgressPercent } = require("../Domain/taskRunPlanner");
const { runGoogleSearchClick } = require("../Automation/googleClick");
const { taskTimeoutMs } = require("../../config/app");

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
  constructor(repository = taskRepository, browserAutomation = runGoogleSearchClick) {
    this.repository = repository;
    this.browserAutomation = browserAutomation;
  }

  async run(task, run, index) {
    await this.repository.updateRun(task._id, index, {
      status: "running",
      startedAt: new Date()
    });

    try {
      const result = await withTimeout(this.browserAutomation({
        keyword: run.keyword,
        targetAddress: task.targetAddress,
        headless: task.headless,
        proxyUrl: task.proxyUrl,
        cookies: task.cookies
      }), taskTimeoutMs + 5000);

      await this.repository.completeRun(task._id, index, {
        status: result.status,
        matchedUrl: result.matchedUrl,
        finishedAt: new Date()
      });
    } catch (error) {
      await this.repository.completeRun(task._id, index, {
        status: "failed",
        error: error.message,
        finishedAt: new Date()
      });
    }
  }

  async updateJobProgress(taskId, job) {
    const task = await this.repository.findById(taskId);
    await job.updateProgress(calculateProgressPercent(task.progress, task.count));
  }
}

module.exports = new TaskRunService();
