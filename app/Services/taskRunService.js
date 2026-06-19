const taskRepository = require("../Repositories/taskRepository");
const { calculateProgressPercent } = require("../Domain/taskRunPlanner");
const { runGoogleSearchClick } = require("../Automation/googleClick");
const { taskTimeoutMs } = require("../../config/app");
const { logger } = require("./logService");
const realtimeEventService = require("./realtimeEventService");
const taskCancellationService = require("./taskCancellationService");
const runScheduleService = require("./runScheduleService");
const cookiePoolService = require("./cookiePoolService");

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Browser run timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function normalizeCandidates(pageNumber, candidates = []) {
  return candidates
    .filter((candidate) => candidate && candidate.href && candidate.host)
    .map((candidate) => ({
      pageNumber,
      rank: Number(candidate.rank || 0),
      host: String(candidate.host).slice(0, 160),
      path: String(candidate.path || "/").slice(0, 400),
      href: String(candidate.href).slice(0, 1000),
      text: String(candidate.text || "").slice(0, 220)
    }));
}

function isSuccessfulResult(result) {
  return result && result.status === "clicked";
}

function shouldRetryFailure(error) {
  return !String(error.message || "").includes("Task cancelled");
}

function isGoogleResponseCodeFailure(error) {
  return String(error && error.message || "").includes("ERR_HTTP_RESPONSE_CODE_FAILURE");
}

function isNonRetryableAutomationResult(result) {
  return Boolean(result && result.retryable === false);
}

function selectCookieSetFromList(cookieSets, runIndex, attemptsBeforeRun = 0) {
  if (!cookieSets.length) return null;
  const cookieSetIndex = (Number(runIndex) + Number(attemptsBeforeRun || 0)) % cookieSets.length;
  const cookieSet = cookieSets[cookieSetIndex];
  const profileKey = cookieSet.profileKey || cookieSet.sourceAccountId || "";
  return {
    cookies: cookieSet.cookies || [],
    cookieSetName: cookieSet.name || `cookie-set-${cookieSetIndex + 1}`,
    cookieSetIndex,
    cookieSetCount: cookieSets.length,
    cookiePoolId: cookieSet._id ? String(cookieSet._id) : "",
    profileKey: profileKey ? String(profileKey) : "",
    sourceProxyHost: cookieSet.sourceProxyHost || ""
  };
}

async function selectRunCookies(task, runIndex, attemptsBeforeRun = 0) {
  if (task.useCookiePool) {
    const activePoolItems = await cookiePoolService.listActiveCookies();
    const selectedPoolItem = selectCookieSetFromList(activePoolItems, runIndex, attemptsBeforeRun);
    if (selectedPoolItem) return selectedPoolItem;
  }

  const cookieSets = Array.isArray(task.cookieSets) ? task.cookieSets.filter((cookieSet) => cookieSet && cookieSet.cookies && cookieSet.cookies.length) : [];
  const selectedCookieSet = selectCookieSetFromList(cookieSets, runIndex, attemptsBeforeRun);
  if (selectedCookieSet) return selectedCookieSet;

  return {
    cookies: task.cookies || [],
    cookieSetName: "",
    cookieSetIndex: null,
    cookieSetCount: 0,
    cookiePoolId: "",
    profileKey: "",
    sourceProxyHost: ""
  };
}

function runProxyHost(proxyUrl) {
  if (!proxyUrl) return "";
  try {
    const url = new URL(proxyUrl);
    return url.host;
  } catch (error) {
    return "";
  }
}

class TaskRunService {
  constructor(repository = taskRepository, browserAutomation = runGoogleSearchClick, scheduleService = runScheduleService, cancellationService = taskCancellationService) {
    this.repository = repository;
    this.browserAutomation = browserAutomation;
    this.scheduleService = scheduleService;
    this.cancellationService = cancellationService;
  }

  async run(task, run, index, options = {}) {
    if (!options.ignoreSchedule) {
      await this.scheduleService.waitUntil(run.scheduledAt);
    }
    await this.cancellationService.assertNotCancelled(task._id);
    const maxAttempts = Math.max(1, Number(task.maxAttempts || 3));

    const logAutomationEvent = (event, meta = {}) => {
      logger.info(event, {
        taskId: String(task._id),
        runIndex: index,
        keyword: run.keyword,
        targetAddress: task.targetAddress,
        ...meta
      });
    };

    const finishRun = options.incrementProgress === false
      ? this.repository.replaceRunResult.bind(this.repository)
      : this.repository.completeRun.bind(this.repository);

    for (;;) {
      await this.cancellationService.assertNotCancelled(task._id);
      const latestTask = await this.repository.findLeanById(task._id);
      if (!latestTask) return;
      const latestRun = latestTask && latestTask.runs && latestTask.runs[index];
      const attemptsBeforeRun = Number((latestRun && latestRun.attempts) || 0);
      const attemptNumber = attemptsBeforeRun + 1;
      const selectedCookies = await selectRunCookies(latestTask, index, attemptsBeforeRun);
      const proxyHost = runProxyHost(latestTask.proxyUrl);
      const cookieSourceProxyHost = selectedCookies.sourceProxyHost || "";

      await this.repository.startRunAttempt(task._id, index);
      await this.repository.updateRun(task._id, index, {
        cookieSetName: selectedCookies.cookieSetName,
        cookieSetIndex: selectedCookies.cookieSetIndex,
        cookieSetCount: selectedCookies.cookieSetCount,
        cookiePoolId: selectedCookies.cookiePoolId,
        browserProfileKey: selectedCookies.profileKey,
        cookieSourceProxyHost,
        proxyHost,
        proxyExitIp: "",
        proxyExitIpError: ""
      });
      await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_started", runIndex: index });
      logAutomationEvent("task_run_started", {
        attempt: attemptNumber,
        maxAttempts,
        cookieSetName: selectedCookies.cookieSetName,
        cookieSetIndex: selectedCookies.cookieSetIndex,
        cookieSetCount: selectedCookies.cookieSetCount,
        cookiePoolId: selectedCookies.cookiePoolId,
        browserProfileKey: selectedCookies.profileKey,
        cookieSourceProxyHost
      });

      if (cookieSourceProxyHost && proxyHost && cookieSourceProxyHost !== proxyHost) {
        logAutomationEvent("task_run_cookie_proxy_mismatch", {
          cookieSourceProxyHost,
          taskProxyHost: proxyHost,
          cookiePoolId: selectedCookies.cookiePoolId
        });
      }

      try {
        const result = await withTimeout(this.browserAutomation({
          keyword: run.keyword,
          targetAddress: task.targetAddress,
          headless: task.headless,
          deviceMode: task.deviceMode || "desktop",
          proxyUrl: task.proxyUrl,
          captchaApiKey: task.captchaApiKey || "",
          cookies: selectedCookies.cookies,
          profileKey: selectedCookies.profileKey,
          onEvent: async (event, meta = {}) => {
            logAutomationEvent(event, meta);
            if (event === "google_search_navigation_started") {
              await this.repository.updateRun(task._id, index, {
                searchUrl: meta.searchUrl,
                lastGoogleUrl: meta.searchUrl,
                googleBlocked: false
              });
            }
            if (event === "browser_proxy_exit_ip_checked") {
              await cookiePoolService.markUsed(selectedCookies.cookiePoolId, {
                taskId: String(task._id),
                runIndex: index,
                exitIp: meta.exitIp || ""
              });
              await this.repository.updateRun(task._id, index, {
                proxyHost: meta.proxyHost || proxyHost,
                proxyExitIp: meta.exitIp || "",
                proxyExitIpError: ""
              });
              await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_proxy_exit_ip_checked", runIndex: index });
            }
            if (event === "browser_proxy_exit_ip_check_failed") {
              await this.repository.updateRun(task._id, index, {
                proxyHost: meta.proxyHost || proxyHost,
                proxyExitIpError: meta.error || "proxy exit IP check failed"
              });
              await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_proxy_exit_ip_check_failed", runIndex: index });
            }
            if (event === "google_results_page_check_started") {
              await this.repository.updateRun(task._id, index, {
                lastGoogleUrl: meta.url
              });
            }
            if (event === "google_results_blocked_by_google") {
              await this.repository.updateRun(task._id, index, {
                lastGoogleUrl: meta.url,
                googleBlocked: true
              });
            }
            if (event === "google_results_empty") {
              await this.repository.updateRun(task._id, index, {
                lastGoogleUrl: meta.url,
                error: meta.message || "Google bu sorgu için hiçbir sonuç döndürmedi."
              });
            }
            if (event === "google_search_navigation_failed") {
              await this.repository.updateRun(task._id, index, {
                lastGoogleUrl: meta.url || meta.searchUrl,
                googleBlocked: Boolean(meta.googleBlocked)
              });
            }
            if (event === "google_results_candidates_seen") {
              await this.repository.appendRunCandidates(
                task._id,
                index,
                normalizeCandidates(meta.pageNumber, meta.candidates)
              );
              await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_candidates_seen", runIndex: index });
            }
            await this.cancellationService.assertNotCancelled(task._id);
          },
        shouldCancel: async () => {
          const latest = await this.repository.findById(task._id);
          return !latest || latest.status === "cancelled" || Number(latest.runVersion || 0) !== Number(task.runVersion || 0);
        }
        }), taskTimeoutMs + 5000);

        if (result.noResults) {
          await finishRun(task._id, index, {
            status: result.status,
            matchedUrl: result.matchedUrl,
            resultPage: result.resultPage,
            resultRank: result.resultRank,
            googleBlocked: false,
            error: result.error || "Google bu sorgu için hiçbir sonuç döndürmedi.",
            finishedAt: new Date()
          });
          await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_completed", runIndex: index });
          logAutomationEvent("task_run_completed", { ...result, attempt: attemptNumber, maxAttempts, retrySkipped: true });
          return;
        }

        if (!isSuccessfulResult(result) && !isNonRetryableAutomationResult(result) && attemptNumber < maxAttempts) {
          if (result.googleBlocked) {
            await cookiePoolService.markBroken(selectedCookies.cookiePoolId, result.status || "blocked_by_google");
          }
          await this.repository.updateRun(task._id, index, {
            status: "queued",
            matchedUrl: result.matchedUrl,
            resultPage: result.resultPage,
            resultRank: result.resultRank,
            googleBlocked: Boolean(result.googleBlocked),
            error: result.error || `attempt ${attemptNumber}/${maxAttempts} ${result.status}`,
            finishedAt: new Date()
          });
          await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_auto_retry_queued", runIndex: index });
          logAutomationEvent("task_run_auto_retry_queued", { attempt: attemptNumber, maxAttempts, status: result.status });
          continue;
        }

        await finishRun(task._id, index, {
          status: result.status,
          matchedUrl: result.matchedUrl,
          resultPage: result.resultPage,
          resultRank: result.resultRank,
          googleBlocked: Boolean(result.googleBlocked),
          error: result.error || "",
          finishedAt: new Date()
        });
        if (result.googleBlocked) {
          await cookiePoolService.markBroken(selectedCookies.cookiePoolId, result.status || "blocked_by_google");
        }
        await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_completed", runIndex: index });
        logAutomationEvent("task_run_completed", { ...result, attempt: attemptNumber, maxAttempts });
        return;
      } catch (error) {
        if (isGoogleResponseCodeFailure(error)) {
          if (attemptNumber < maxAttempts) {
            await cookiePoolService.markBroken(selectedCookies.cookiePoolId, "blocked_by_google");
            await this.repository.updateRun(task._id, index, {
              status: "queued",
              googleBlocked: true,
              error: `attempt ${attemptNumber}/${maxAttempts} blocked_by_google`,
              finishedAt: new Date()
            });
            await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_auto_retry_queued", runIndex: index });
            logAutomationEvent("task_run_auto_retry_queued", { attempt: attemptNumber, maxAttempts, status: "blocked_by_google", error: error.message });
            continue;
          }

          await cookiePoolService.markBroken(selectedCookies.cookiePoolId, "blocked_by_google");
          await finishRun(task._id, index, {
            status: "blocked_by_google",
            googleBlocked: true,
            error: error.message,
            finishedAt: new Date()
          });
          await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_completed", runIndex: index });
          logAutomationEvent("task_run_completed", { status: "blocked_by_google", googleBlocked: true, error: error.message, attempt: attemptNumber, maxAttempts });
          return;
        }

        if (shouldRetryFailure(error) && attemptNumber < maxAttempts) {
          await this.repository.updateRun(task._id, index, {
            status: "queued",
            error: `attempt ${attemptNumber}/${maxAttempts} ${error.message}`,
            finishedAt: new Date()
          });
          await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_auto_retry_queued", runIndex: index });
          logAutomationEvent("task_run_auto_retry_queued", { attempt: attemptNumber, maxAttempts, error: error.message });
          continue;
        }

        await finishRun(task._id, index, {
          status: "failed",
          error: error.message,
          finishedAt: new Date()
        });
        await realtimeEventService.publish("task.updated", { taskId: String(task._id), action: "run_failed", runIndex: index });
        logAutomationEvent("task_run_failed", { error: error.message, attempt: attemptNumber, maxAttempts });
        return;
      }
    }
  }

  async updateJobProgress(taskId, job) {
    const task = await this.repository.findById(taskId);
    await job.updateProgress(calculateProgressPercent(task.progress, task.count));
  }
}

module.exports = new TaskRunService();
