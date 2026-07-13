const mrLoginJobRepository = require("../Repositories/mrLoginJobRepository");
const mrLoginJobService = require("./mrLoginJobService");
const realtimeEventService = require("./realtimeEventService");
const { logger } = require("./logService");
const { validateLaunchPayload } = require("../Validators/mrLoginValidator");
const { runMrKingLogin } = require("../Automation/mrKingLogin");
const { HttpError } = require("../Utils/httpError");

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "********";
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
}

function publicJob(job) {
  const json = typeof job.toJSON === "function" ? job.toJSON() : job;
  return {
    ...json,
    password: undefined,
    emailAuthCode: undefined,
    maskedPassword: maskSecret(json.password),
    cookies: (json.cookies || []).map((cookie) => ({
      ...cookie,
      value: maskSecret(cookie.value)
    })),
    session: {
      url: json.session && json.session.url || "",
      localStorage: ((json.session && json.session.localStorage) || []).map((item) => ({
        key: item.key,
        value: maskSecret(item.value)
      })),
      sessionStorage: ((json.session && json.session.sessionStorage) || []).map((item) => ({
        key: item.key,
        value: maskSecret(item.value)
      }))
    }
  };
}

class MrLoginService {
  constructor(repository = mrLoginJobRepository, jobService = mrLoginJobService, automation = runMrKingLogin) {
    this.repository = repository;
    this.jobService = jobService;
    this.automation = automation;
  }

  async listJobs() {
    const jobs = await this.repository.findRecent();
    return jobs.map(publicJob);
  }

  async launch(payload) {
    const options = validateLaunchPayload(payload);
    const job = await this.repository.create({
      email: options.email,
      password: options.password,
      loginUrl: options.loginUrl,
      profileKey: `mr-login-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      status: "queued",
      logs: [{
        at: new Date(),
        event: "mr_login_queued",
        message: "MR giriş job kuyruğa alındı.",
        meta: { email: options.email, loginUrl: options.loginUrl }
      }]
    });

    await this.jobService.enqueue(job._id);
    await realtimeEventService.publish("mrLogin.updated", { action: "queued", jobId: String(job._id) });
    logger.info("mr_login_job_queued", { jobId: String(job._id), email: options.email });

    return publicJob(job);
  }

  async runJob(jobId) {
    const job = await this.repository.findById(jobId);
    if (!job) throw new HttpError(404, "MR login job not found");

    await this.repository.markRunning(jobId);
    await this.addLog(jobId, "mr_login_started", "MR giriş job başladı.", { email: job.email });
    await realtimeEventService.publish("mrLogin.updated", { action: "started", jobId: String(jobId) });

    const onEvent = async (event, message, meta = {}) => {
      logger.info(event, { jobId: String(jobId), ...meta });
      await this.addLog(jobId, event, message, meta);
      await realtimeEventService.publish("mrLogin.updated", {
        action: "log",
        jobId: String(jobId),
        event,
        message
      });
    };

    const result = await this.automation({
      email: job.email,
      password: job.password,
      loginUrl: job.loginUrl,
      profileKey: job.profileKey,
      proxyUrl: job.proxyUrl || "",
      getEmailAuthCode: async () => {
        const fresh = await this.repository.findById(jobId);
        return fresh ? String(fresh.emailAuthCode || "").trim() : "";
      },
      onEvent
    });

    if (!result.success) {
      await this.repository.markFailed(jobId, {
        lastError: result.error || "MR login failed",
        lastUrl: result.url || ""
      });
      await realtimeEventService.publish("mrLogin.updated", { action: "failed", jobId: String(jobId) });
      throw new HttpError(400, result.error || "MR login failed");
    }

    const completed = await this.repository.markCompleted(jobId, {
      cookieCount: (result.cookies || []).length,
      cookies: result.cookies || [],
      session: result.session || {},
      lastUrl: result.url || ""
    });
    await realtimeEventService.publish("mrLogin.updated", { action: "completed", jobId: String(jobId) });
    return publicJob(completed);
  }

  async addLog(jobId, event, message, meta = {}) {
    return this.repository.appendLog(jobId, { event, message, meta });
  }

  async submitEmailCode(jobId, payload = {}) {
    const code = String(payload.code || "").trim();
    if (!code) {
      throw new HttpError(422, "Email doğrulama kodu gerekli");
    }

    const job = await this.repository.submitEmailAuthCode(jobId, code);
    if (!job) return null;

    await this.addLog(jobId, "mr_login_email_auth_code_received", "Email doğrulama kodu panelden alındı.");
    await realtimeEventService.publish("mrLogin.updated", {
      action: "email_code_received",
      jobId: String(jobId)
    });
    return publicJob(job);
  }
}

module.exports = new MrLoginService();
