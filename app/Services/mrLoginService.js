const mrLoginJobRepository = require("../Repositories/mrLoginJobRepository");
const mrLoginJobService = require("./mrLoginJobService");
const realtimeEventService = require("./realtimeEventService");
const { logger } = require("./logService");
const {
  validateCredentialPayload,
  validateLaunchPayload,
  validateWarmupPayload
} = require("../Validators/mrLoginValidator");
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

  async createWarmupJob(options, slotIndex = 1, initialCredentials = null) {
    const job = await this.repository.create({
      mode: "warmup",
      email: initialCredentials ? initialCredentials.email : "",
      password: initialCredentials ? initialCredentials.password : "",
      loginUrl: options.loginUrl,
      proxyUrl: options.proxyUrl,
      credentialsSubmittedAt: initialCredentials ? new Date() : undefined,
      profileKey: `mr-warmup-${Date.now()}-${slotIndex}-${Math.random().toString(16).slice(2)}`,
      slotIndex,
      status: "queued",
      logs: [{
        at: new Date(),
        event: "mr_login_warmup_queued",
        message: "MR hazır browser kuyruğa alındı.",
        meta: { loginUrl: options.loginUrl, slotIndex }
      }]
    });
    await this.jobService.enqueue(job._id, { mode: "warmup" });
    return job;
  }

  async warmup(payload) {
    const options = validateWarmupPayload(payload);
    const jobs = [];

    for (let index = 0; index < options.browserCount; index += 1) {
      jobs.push(await this.createWarmupJob(options, index + 1));
    }

    await realtimeEventService.publish("mrLogin.updated", { action: "warmup_queued" });
    logger.info("mr_login_warmup_queued", { count: jobs.length, loginUrl: options.loginUrl });

    return jobs.map(publicJob);
  }

  async runJob(jobId) {
    const job = await this.repository.findById(jobId);
    if (!job) throw new HttpError(404, "MR login job not found");

    await this.repository.markRunning(jobId);
    await this.addLog(jobId, "mr_login_started", "MR giriş job başladı.", { email: job.email, mode: job.mode });
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
      waitForCredentials: job.mode === "warmup",
      getCredentials: async () => {
        const fresh = await this.repository.findById(jobId);
        if (!fresh || !fresh.credentialsSubmittedAt) return null;
        return {
          email: String(fresh.email || "").trim(),
          password: String(fresh.password || ""),
          submittedAt: fresh.credentialsSubmittedAt
        };
      },
      markReady: async () => {
        await this.repository.markReady(jobId);
        await realtimeEventService.publish("mrLogin.updated", { action: "ready", jobId: String(jobId) });
      },
      onEvent
    });

    if (!result.success) {
      await this.repository.markFailed(jobId, {
        lastError: result.error || "MR login failed",
        lastUrl: result.url || ""
      });
      await realtimeEventService.publish("mrLogin.updated", { action: "failed", jobId: String(jobId) });
      if (job.mode === "warmup") {
        await this.replenishWarmup(job);
      }
      throw new HttpError(400, result.error || "MR login failed");
    }

    const completed = await this.repository.markCompleted(jobId, {
      cookieCount: (result.cookies || []).length,
      cookies: result.cookies || [],
      session: result.session || {},
      lastUrl: result.url || ""
    });
    await realtimeEventService.publish("mrLogin.updated", { action: "completed", jobId: String(jobId) });
    if (job.mode === "warmup") {
      await this.replenishWarmup(job);
    }
    return publicJob(completed);
  }

  async replenishWarmup(job) {
    const replacement = await this.createWarmupJob({
      loginUrl: job.loginUrl,
      proxyUrl: job.proxyUrl || ""
    }, job.slotIndex || 1);
    await this.addLog(replacement._id, "mr_login_warmup_replenished", "Kullanılan MR browser yerine yeni hazır browser açılıyor.", {
      previousJobId: String(job._id)
    });
    await realtimeEventService.publish("mrLogin.updated", {
      action: "warmup_replenished",
      jobId: String(replacement._id)
    });
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

  async submitCredentials(payload = {}) {
    const credentials = validateCredentialPayload(payload);
    const options = validateWarmupPayload(payload);
    const readyJobs = await this.repository.findRecent(50);
    const job = readyJobs.find((item) => item.mode === "warmup" && ["ready", "running"].includes(item.status));

    if (!job) {
      const created = await this.createWarmupJob(options, 1, credentials);
      await this.addLog(created._id, "mr_login_credentials_queued_with_warmup", "Hazır browser yoktu; yeni browser açılıp credential bağlandı.", {
        email: credentials.email
      });
      await realtimeEventService.publish("mrLogin.updated", {
        action: "credentials_queued_with_warmup",
        jobId: String(created._id)
      });
      return publicJob(created);
    }

    const updated = await this.repository.submitCredentials(job._id, credentials);
    await this.addLog(job._id, "mr_login_credentials_received", "Giriş bilgileri hazır browser'a gönderildi.", {
      email: credentials.email
    });
    await realtimeEventService.publish("mrLogin.updated", {
      action: "credentials_received",
      jobId: String(job._id)
    });
    return publicJob(updated);
  }
}

module.exports = new MrLoginService();
