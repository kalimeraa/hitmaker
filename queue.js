const { Queue, QueueEvents } = require("bullmq");
const { redis, queueName } = require("./config");

const browserQueue = new Queue(queueName, { connection: redis });
const queueEvents = new QueueEvents(queueName, { connection: redis });

module.exports = { browserQueue, queueEvents };
