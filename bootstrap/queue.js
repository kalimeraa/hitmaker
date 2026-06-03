const { Queue, QueueEvents } = require("bullmq");
const { redis, queueName } = require("../config/app");

const browserQueue = new Queue(queueName, { connection: redis });
const queueEvents = new QueueEvents(queueName, { connection: redis });

module.exports = { browserQueue, queueEvents };
