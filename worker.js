const { Worker } = require("bullmq");
const { redis, queueName } = require("./config/app");
const { connectDb } = require("./bootstrap/database");
const taskProcessorService = require("./app/Services/taskProcessorService");
const { logger } = require("./app/Services/logService");

async function main() {
  await connectDb();

  const worker = new Worker(queueName, (job) => taskProcessorService.process(job), {
    connection: redis,
    concurrency: 1
  });

  worker.on("completed", (job) => {
    logger.info("task_job_completed", { jobId: job.id });
  });

  worker.on("failed", async (job, error) => {
    logger.error("task_job_failed", { jobId: job && job.id, error: error.message });
    if (job && job.data.taskId) {
      await taskProcessorService.markFailed(job.data.taskId, error.message);
    }
  });
}

main().catch((error) => {
  logger.error("worker_boot_failed", { error: error.message, stack: error.stack });
  process.exit(1);
});
