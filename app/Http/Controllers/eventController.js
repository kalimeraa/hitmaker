const { queueEvents } = require("../../../bootstrap/queue");
const realtimeEventService = require("../../Services/realtimeEventService");

class EventController {
  async stream(req, res) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("connected", { ok: true });

    const subscriber = realtimeEventService.createSubscriber();
    await subscriber.subscribe(realtimeEventService.channel);
    const relayRealtimeEvent = (_channel, message) => {
      try {
        const event = JSON.parse(message);
        send(event.type, event.payload);
      } catch (error) {
        send("stream.error", { error: error.message });
      }
    };

    const completed = ({ jobId, returnvalue }) => send("completed", { jobId, returnvalue });
    const failed = ({ jobId, failedReason }) => send("failed", { jobId, failedReason });
    const progress = ({ jobId, data }) => send("progress", { jobId, data });
    const heartbeat = setInterval(() => send("heartbeat", { ok: true }), 25000);

    subscriber.on("message", relayRealtimeEvent);
    queueEvents.on("completed", completed);
    queueEvents.on("failed", failed);
    queueEvents.on("progress", progress);

    req.on("close", () => {
      subscriber.off("message", relayRealtimeEvent);
      subscriber.quit().catch(() => {});
      clearInterval(heartbeat);
      queueEvents.off("completed", completed);
      queueEvents.off("failed", failed);
      queueEvents.off("progress", progress);
    });
  }
}

module.exports = new EventController();
