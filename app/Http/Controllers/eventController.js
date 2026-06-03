const { queueEvents } = require("../../../bootstrap/queue");

class EventController {
  stream(req, res) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const completed = ({ jobId, returnvalue }) => send("completed", { jobId, returnvalue });
    const failed = ({ jobId, failedReason }) => send("failed", { jobId, failedReason });
    const progress = ({ jobId, data }) => send("progress", { jobId, data });

    queueEvents.on("completed", completed);
    queueEvents.on("failed", failed);
    queueEvents.on("progress", progress);

    req.on("close", () => {
      queueEvents.off("completed", completed);
      queueEvents.off("failed", failed);
      queueEvents.off("progress", progress);
    });
  }
}

module.exports = new EventController();
