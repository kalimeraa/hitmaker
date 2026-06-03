const IORedis = require("ioredis");
const { redis } = require("../../config/app");

const CHANNEL = "hitmaker:events";

class RealtimeEventService {
  constructor(redisConfig = redis) {
    this.publisher = new IORedis(redisConfig);
  }

  async publish(type, payload = {}) {
    await this.publisher.publish(CHANNEL, JSON.stringify({
      type,
      payload,
      emittedAt: new Date().toISOString()
    }));
  }

  createSubscriber() {
    return new IORedis(redis);
  }

  get channel() {
    return CHANNEL;
  }
}

module.exports = new RealtimeEventService();
