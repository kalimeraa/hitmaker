function expandKeywords(keywords, count) {
  const cleanKeywords = keywords.filter(Boolean);
  return Array.from({ length: count }, (_, index) => cleanKeywords[index % cleanKeywords.length]);
}

function calculateScheduledAt(startsAt, durationHours, count, index) {
  if (!durationHours) return startsAt;

  const durationMs = durationHours * 60 * 60 * 1000;
  const bucketMs = durationMs / count;
  const bucketStartMs = bucketMs * index;
  const randomOffsetMs = Math.floor(Math.random() * bucketMs * 0.85);
  const offsetMs = Math.floor(bucketStartMs + randomOffsetMs);
  return new Date(startsAt.getTime() + offsetMs);
}

function buildQueuedRuns(keywords, count, options = {}) {
  const startsAt = options.startsAt || new Date();
  const durationHours = Number(options.durationHours || 0);

  return expandKeywords(keywords, count).map((keyword, index) => ({
    keyword,
    status: "queued",
    scheduledAt: calculateScheduledAt(startsAt, durationHours, count, index)
  }));
}

function resolveFinalTaskStatus(runs) {
  return runs.some((run) => run.status === "failed") ? "failed" : "completed";
}

function calculateProgressPercent(progress, count) {
  if (!count) return 0;
  return Math.round((progress / count) * 100);
}

module.exports = {
  buildQueuedRuns,
  calculateProgressPercent,
  resolveFinalTaskStatus
};
