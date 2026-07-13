const { Queue, QueueEvents } = require("bullmq");
const { redis, queueName } = require("../config/app");

const browserQueue = new Queue(queueName, { connection: redis });
const queueEvents = new QueueEvents(queueName, { connection: redis });
const mrLoginQueueName = `${queueName}-mr-login`;
const mrLoginQueue = new Queue(mrLoginQueueName, { connection: redis });
const mrLoginQueueEvents = new QueueEvents(mrLoginQueueName, { connection: redis });

module.exports = {
  browserQueue,
  queueEvents,
  mrLoginQueue,
  mrLoginQueueEvents,
  mrLoginQueueName
};
