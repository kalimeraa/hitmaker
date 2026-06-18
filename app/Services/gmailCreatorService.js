const gmailCreatorJobRepository = require("../Repositories/gmailCreatorJobRepository");
const googleAuthAccountRepository = require("../Repositories/googleAuthAccountRepository");
const realtimeEventService = require("./realtimeEventService");
const { logger } = require("./logService");
const { createGmailAccount } = require("../Automation/gmailAccountCreator");
const { generateSignupIdentity } = require("../Domain/gmailSignupIdentity");
const { validateCreateJobPayload } = require("../Validators/gmailCreatorValidator");
const { detectProxyProvider } = require("./proxyProviderService");
const { HttpError } = require("../Utils/httpError");

function classifyCreationFailure(result = {}) {
  const reason = result.failureReason || "";
  if (reason === "manual_timeout") return "terminal";
  if (reason === "signup_step" || reason === "automation_error") return "retry";
  if (/TUNNEL_CONNECTION_FAILED|ECONNRESET|ETIMEDOUT|net::ERR|timeout|Target closed/i.test(String(result.error || ""))) {
    return "retry";
  }
  return "terminal";
}

class GmailCreatorService {
  constructor(jobRepository = gmailCreatorJobRepository, accountRepository = googleAuthAccountRepository, automation = createGmailAccount) {
    this.jobRepository = jobRepository;
    this.accountRepository = accountRepository;
    this.automation = automation;
  }

  async listJobs() {
    const jobs = await this.jobRepository.findRecent();
    return jobs.map((job) => job.toJSON());
  }

  async getJob(id) {
    const job = await this.jobRepository.findById(id);
    return job ? job.toJSON() : null;
  }

  async deleteJob(id) {
    const job = await this.jobRepository.deleteById(id);
    return job ? job.toJSON() : null;
  }

  async runJob(jobId, options) {
    const job = await this.jobRepository.findById(jobId);
    if (!job) {
      throw new HttpError(404, "Gmail creator job not found");
    }

    const effectiveProxyUrl = options.proxyUrl || job.proxyUrl || "";
    const proxyProvider = detectProxyProvider(effectiveProxyUrl);
    const canRotate = Boolean(proxyProvider && proxyProvider.manualReset && options.proxyResetUrl);
    const maxAttempts = canRotate ? options.maxAttempts : 1;
    const profileKey = String(job._id);

    const onEvent = async (event, meta = {}) => {
      logger.info(event, { jobId: String(job._id), ...meta });
      if (event === "gmail_creator_manual_wait" || event === "gmail_creator_phone_manual_required") {
        await this.jobRepository.markAwaitingManual(jobId, {
          manualHint: meta.hint || meta.url || "",
          lastUrl: meta.url || ""
        });
        await realtimeEventService.publish("gmailCreator.updated", {
          action: "awaiting_manual",
          jobId: String(job._id),
          hint: meta.hint || ""
        });
      }
    };

    await this.jobRepository.markRunning(jobId, { profileKey, attempt: 1, maxAttempts });
    await realtimeEventService.publish("gmailCreator.updated", { action: "started", jobId: String(job._id) });

    const identity = generateSignupIdentity({
      firstName: job.firstName || undefined,
      lastName: job.lastName || undefined,
      password: job.password || undefined,
      username: job.username || undefined
    });

    await this.jobRepository.update(jobId, {
      firstName: identity.firstName,
      lastName: identity.lastName,
      username: identity.username,
      email: identity.email,
      password: identity.password,
      birthday: identity.birthday
    });

    let result = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await onEvent("gmail_creator_attempt_started", { attempt, maxAttempts, canRotate });

      if (canRotate) {
        await onEvent("gmail_creator_proxy_reset_started", { provider: proxyProvider.name, attempt });
        const reset = await proxyProvider.resetIp({ resetUrl: options.proxyResetUrl });
        await onEvent(reset.success ? "gmail_creator_proxy_reset_completed" : "gmail_creator_proxy_reset_failed", {
          provider: proxyProvider.name,
          attempt,
          status: reset.status,
          error: reset.error
        });
      }

      await this.jobRepository.markRunning(jobId, { attempt, lastUrl: "" });

      result = await this.automation({
        identity,
        proxyUrl: effectiveProxyUrl,
        deviceMode: options.deviceMode || job.deviceMode,
        profileKey,
        onEvent
      });

      if (result.success) break;

      const decision = classifyCreationFailure(result);
      await onEvent("gmail_creator_attempt_failed", {
        attempt,
        maxAttempts,
        failureReason: result.failureReason || "",
        error: result.error || "",
        decision
      });
      if (decision === "terminal" || attempt >= maxAttempts) break;
    }

    if (!result || !result.success) {
      const failure = result || { error: "gmail_creator_failed" };
      await this.jobRepository.markFailed(jobId, {
        lastError: failure.error || "Gmail creator failed",
        lastUrl: failure.url || "",
        failureReason: failure.failureReason || ""
      });
      await realtimeEventService.publish("gmailCreator.updated", {
        action: "failed",
        jobId: String(job._id),
        reason: failure.failureReason || ""
      });
      throw new HttpError(400, failure.error || "Gmail creator failed");
    }

    const account = await this.accountRepository.create({
      email: result.email,
      password: result.password,
      firstName: result.firstName,
      lastName: result.lastName,
      proxyUrl: effectiveProxyUrl,
      notes: options.notes || job.notes || `Gmail creator · ${new Date().toISOString()}`,
      source: "created",
      status: "active"
    });

    await this.jobRepository.markCompleted(jobId, {
      email: result.email,
      password: result.password,
      username: result.username,
      accountId: String(account._id),
      lastUrl: result.url || ""
    });

    logger.info("gmail_creator_account_saved", {
      jobId: String(job._id),
      accountId: String(account._id),
      email: result.email
    });

    await realtimeEventService.publish("gmailCreator.updated", {
      action: "completed",
      jobId: String(job._id),
      accountId: String(account._id),
      email: result.email
    });
    await realtimeEventService.publish("googleAuth.updated", {
      action: "created",
      accountId: String(account._id),
      source: "created"
    });

    return {
      job: (await this.jobRepository.findById(jobId)).toJSON(),
      account: account.toJSON()
    };
  }

  async createAndRun(payload) {
    const options = validateCreateJobPayload(payload);
    const results = [];

    for (let index = 0; index < options.count; index += 1) {
      const identity = generateSignupIdentity();
      const job = await this.jobRepository.create({
        firstName: identity.firstName,
        lastName: identity.lastName,
        username: identity.username,
        email: identity.email,
        password: identity.password,
        birthday: identity.birthday,
        proxyUrl: options.proxyUrl,
        proxyResetUrl: options.proxyResetUrl,
        deviceMode: options.deviceMode,
        maxAttempts: options.maxAttempts,
        notes: options.notes,
        profileKey: "",
        status: "queued"
      });

      logger.info("gmail_creator_job_created", { jobId: String(job._id), index: index + 1, count: options.count });
      await realtimeEventService.publish("gmailCreator.updated", { action: "queued", jobId: String(job._id) });

      try {
        const result = await this.runJob(String(job._id), options);
        results.push({ success: true, jobId: String(job._id), email: result.account.email });
      } catch (error) {
        results.push({ success: false, jobId: String(job._id), error: error.message || "failed" });
      }
    }

    return {
      requested: options.count,
      successCount: results.filter((item) => item.success).length,
      failedCount: results.filter((item) => !item.success).length,
      results
    };
  }

  async retryJob(id, payload = {}) {
    const partial = validateCreateJobPayload({ ...payload, count: 1 });
    return this.runJob(id, partial);
  }
}

module.exports = new GmailCreatorService();
