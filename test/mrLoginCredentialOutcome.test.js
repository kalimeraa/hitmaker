const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveMrLoginCredentialOutcome } = require("../app/Domain/mrLoginCredentialOutcome");

const submittedAt = new Date("2026-07-13T17:42:21.953Z");

test("detects invalid credentials after the submitted credential timestamp", () => {
  const outcome = resolveMrLoginCredentialOutcome({
    status: "running",
    logs: [
      { at: new Date("2026-07-13T17:42:20.000Z"), event: "mr_login_invalid_credentials" },
      { at: new Date("2026-07-13T17:42:23.000Z"), event: "mr_login_invalid_credentials" }
    ]
  }, submittedAt);

  assert.deepEqual(outcome, { type: "invalid_credentials" });
});

test("ignores stale invalid credential logs from earlier submissions", () => {
  const outcome = resolveMrLoginCredentialOutcome({
    status: "running",
    logs: [
      { at: new Date("2026-07-13T17:42:20.000Z"), event: "mr_login_invalid_credentials" }
    ]
  }, submittedAt);

  assert.deepEqual(outcome, { type: "pending" });
});

test("detects email-code requirement as a credential outcome", () => {
  const outcome = resolveMrLoginCredentialOutcome({
    status: "running",
    logs: [
      { at: new Date("2026-07-13T17:42:24.000Z"), event: "mr_login_email_auth_required" }
    ]
  }, submittedAt);

  assert.deepEqual(outcome, { type: "email_code_required" });
});

test("detects terminal job states", () => {
  assert.deepEqual(resolveMrLoginCredentialOutcome({
    status: "completed",
    logs: []
  }, submittedAt), { type: "completed" });

  assert.deepEqual(resolveMrLoginCredentialOutcome({
    status: "failed",
    lastError: "login_success_uncertain",
    logs: []
  }, submittedAt), { type: "failed", error: "login_success_uncertain" });
});
