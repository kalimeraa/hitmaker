const { port } = require("./config");
const { connectDb } = require("./db");
const { queueEvents } = require("./queue");
const { createApp } = require("./app");
const { logger } = require("./services/logService");

async function main() {
  await connectDb();
  await queueEvents.waitUntilReady();
  const app = createApp();
  app.listen(port, () => {
    logger.info("server_started", { url: `http://localhost:${port}` });
  });
}

main().catch((error) => {
  logger.error("server_boot_failed", { error: error.message, stack: error.stack });
  process.exit(1);
});
