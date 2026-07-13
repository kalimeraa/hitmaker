const { Worker } = require("bullmq");
const { mrLoginMaxBrowsers, redis } = require("./config/app");
const { connectDb } = require("./bootstrap/database");
const { mrLoginQueueName, mrLoginQueue } = require("./bootstrap/queue");
const mrLoginService = require("./app/Services/mrLoginService");
const { logger } = require("./app/Services/logService");

async function main() {
  await connectDb();

  // Proje açılışında eski/stalled warmup job'ları otomatik browser AÇMASIN diye kuyruğu boşalt.
  // Hazır browser'lar yalnızca "Browserı hazır et" butonuyla (POST /api/mr-giris/warmup) açılır.
  // UI geçmişi MongoDB'de tutulduğundan bu temizlik listeyi etkilemez.
  await mrLoginQueue.obliterate({ force: true }).catch((error) => {
    logger.warn("mr_login_queue_clear_failed", { error: error.message });
  });

  const worker = new Worker(mrLoginQueueName, (job) => mrLoginService.runJob(job.data.jobId), {
    connection: redis,
    concurrency: Math.max(1, Number(mrLoginMaxBrowsers) || 1)
  });

  worker.on("completed", (job) => {
    logger.info("mr_login_job_completed", { jobId: job.id });
  });

  worker.on("failed", (job, error) => {
    logger.error("mr_login_job_failed", { jobId: job && job.id, error: error.message });
  });
}

main().catch((error) => {
  logger.error("mr_login_worker_boot_failed", { error: error.message, stack: error.stack });
  process.exit(1);
});
