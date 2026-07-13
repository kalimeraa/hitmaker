const { mirrorSite } = require("../Automation/siteMirror");
const realtimeEventService = require("./realtimeEventService");
const { logger } = require("./logService");
const { headlessDefault } = require("../../config/app");

// Site mirror işleri UZUN sürer (crawl). Bu yüzden web isteğini bloklamadan arka planda çalıştırılır,
// ilerleme SSE ile canlı yayınlanır ve duraklat/devam/durdur ile kontrol edilir.
// Not: job state IN-MEMORY tutulur; uygulama restart olursa süren job kaybolur.
const jobs = new Map();
let sequence = 0;

const MAX_KEPT_JOBS = 20;

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function buildOptions(payload = {}) {
  const url = String(payload.url || "").trim();
  if (!url) throw badRequest("url is required");

  const proxyUrl = String(payload.proxyUrl || payload.proxy || "").trim() || undefined;
  if (proxyUrl) {
    try {
      // eslint-disable-next-line no-new
      new URL(proxyUrl);
    } catch (error) {
      throw badRequest("proxyUrl is not a valid URL");
    }
  }

  return {
    url,
    proxyUrl,
    maxDepth: clampInt(payload.maxDepth, 0, 5, 2),
    maxPages: clampInt(payload.maxPages, 1, 500, 25),
    deviceMode: payload.deviceMode === "mobile" ? "mobile" : "desktop",
    headless: typeof payload.headless === "boolean" ? payload.headless : headlessDefault,
    sameHostOnly: payload.sameHostOnly !== false,
    stripTracking: payload.stripTracking !== false
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt
  };
}

function nowIso() {
  return new Date().toISOString();
}

async function emit(job) {
  job.updatedAt = nowIso();
  await realtimeEventService
    .publish("siteMirror.updated", {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result || null,
      error: job.error || null
    })
    .catch(() => {});
}

function trimJobs() {
  if (jobs.size <= MAX_KEPT_JOBS) return;
  // En eski, artık aktif olmayan job'ları at.
  const removable = Array.from(jobs.values())
    .filter((job) => !["running", "paused"].includes(job.status))
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  while (jobs.size > MAX_KEPT_JOBS && removable.length) {
    jobs.delete(removable.shift().id);
  }
}

async function run(job) {
  const onProgress = async (progress) => {
    // Duraklama sırasında status'u koru; aksi halde phase'e göre güncelle.
    if (progress.phase === "paused") job.status = "paused";
    else if (progress.phase === "running" && job.status !== "paused") job.status = "running";
    job.progress = { ...job.progress, ...progress };
    await emit(job);
  };

  const onEvent = async (event, meta = {}) => {
    logger.info(event, { jobId: job.id, ...meta });
  };

  try {
    const result = await mirrorSite({ ...job.options, control: job.control, onProgress, onEvent });
    job.result = result;
    job.status = result.stopped ? "stopped" : "completed";
  } catch (error) {
    job.error = error.message;
    job.status = "failed";
    logger.error("site_mirror_job_failed", { jobId: job.id, error: error.message });
  } finally {
    await emit(job);
    trimJobs();
  }
}

function start(payload) {
  const options = buildOptions(payload);
  sequence += 1;
  const id = `mirror_${Date.now()}_${sequence}`;
  const job = {
    id,
    url: options.url,
    options,
    status: "running",
    control: { pause: false, stop: false },
    progress: {
      visited: 0,
      queued: 0,
      maxPages: options.maxPages,
      savedAssets: 0,
      bytes: 0,
      currentUrl: "",
      phase: "running"
    },
    result: null,
    error: null,
    startedAt: nowIso(),
    updatedAt: nowIso()
  };

  jobs.set(id, job);
  logger.info("site_mirror_job_started", { jobId: id, url: options.url, maxDepth: options.maxDepth, maxPages: options.maxPages });
  emit(job).catch(() => {});
  // Arka planda çalıştır (await etme).
  run(job);
  return publicJob(job);
}

function get(id) {
  return publicJob(jobs.get(id));
}

function list() {
  return Array.from(jobs.values())
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .map(publicJob);
}

function activeJob() {
  return list().find((job) => ["running", "paused"].includes(job.status)) || null;
}

async function pause(id) {
  const job = jobs.get(id);
  if (!job || !["running"].includes(job.status)) return publicJob(job);
  job.control.pause = true;
  job.status = "paused";
  await emit(job);
  return publicJob(job);
}

async function resume(id) {
  const job = jobs.get(id);
  if (!job || job.status !== "paused") return publicJob(job);
  job.control.pause = false;
  job.status = "running";
  await emit(job);
  return publicJob(job);
}

async function stop(id) {
  const job = jobs.get(id);
  if (!job || !["running", "paused"].includes(job.status)) return publicJob(job);
  job.control.stop = true;
  job.control.pause = false; // duraklama kapısını aç ki döngü kırılabilsin
  await emit(job);
  return publicJob(job);
}

module.exports = { start, get, list, activeJob, pause, resume, stop };
