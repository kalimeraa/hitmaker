function findLastLogIndex(logs, events) {
  const eventSet = new Set(events);
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (eventSet.has(logs[index].event)) return index;
  }
  return -1;
}

function resolveMrLoginActionRequired(job) {
  const logs = Array.isArray(job && job.logs) ? job.logs : [];
  const status = String(job && job.status || "");
  const mode = String(job && job.mode || "");

  if (mode === "warmup" && status === "ready") {
    return "credentials";
  }

  const emailAuthRequestedAt = findLastLogIndex(logs, [
    "mr_login_email_auth_required",
    "mr_login_email_auth_code_rejected",
    "mr_login_email_auth_still_visible"
  ]);
  const emailAuthResolvedAt = findLastLogIndex(logs, [
    "mr_login_email_auth_code_received",
    "mr_login_email_auth_submitted",
    "mr_login_email_auth_wait_finished",
    "mr_login_success_detected"
  ]);

  if (status === "running" && emailAuthRequestedAt > emailAuthResolvedAt) {
    return "email_code";
  }

  const invalidCredentialsAt = findLastLogIndex(logs, ["mr_login_invalid_credentials"]);
  const credentialsReceivedAt = findLastLogIndex(logs, ["mr_login_credentials_received"]);
  if (mode === "warmup" && status === "running" && invalidCredentialsAt > credentialsReceivedAt) {
    return "credentials";
  }

  return "none";
}

module.exports = {
  resolveMrLoginActionRequired
};
