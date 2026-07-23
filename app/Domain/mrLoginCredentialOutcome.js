function toTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function logsAfter(logs, since) {
  const sinceTime = toTime(since);
  return (Array.isArray(logs) ? logs : []).filter((log) => toTime(log.at) >= sinceTime);
}

function hasEvent(logs, event) {
  return logs.some((log) => log.event === event);
}

function resolveMrLoginCredentialOutcome(job, credentialsSubmittedAt) {
  if (!job) return { type: "missing" };

  const status = String(job.status || "");
  const relevantLogs = logsAfter(job.logs, credentialsSubmittedAt);

  if (hasEvent(relevantLogs, "mr_login_invalid_credentials")) {
    return { type: "invalid_credentials" };
  }

  if (hasEvent(relevantLogs, "mr_login_email_auth_required")) {
    return { type: "email_code_required" };
  }

  if (status === "completed") {
    return { type: "completed" };
  }

  if (status === "failed") {
    return { type: "failed", error: job.lastError || "MR login failed" };
  }

  return { type: "pending" };
}

module.exports = {
  resolveMrLoginCredentialOutcome
};
