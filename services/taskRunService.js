const taskRepository = require("../repositories/taskRepository");
const { calculateProgressPercent } = require("../domain/taskRunPlanner");
const { runGoogleSearchClick } = require("../automation/googleClick");

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
      const result = await this.browserAutomation({
        keyword: run.keyword,
        targetAddress: task.targetAddress,
        headless: task.headless,
        proxyUrl: task.proxyUrl,
        cookies: task.cookies
      });

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
