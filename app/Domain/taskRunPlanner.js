function expandKeywords(keywords, count) {
  const cleanKeywords = keywords.filter(Boolean);
  return Array.from({ length: count }, (_, index) => cleanKeywords[index % cleanKeywords.length]);
}

function buildQueuedRuns(keywords, count) {
  return expandKeywords(keywords, count).map((keyword) => ({
    keyword,
    status: "queued"
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
