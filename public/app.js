function statusBadge(status) {
  return `<span class="status-pill status-${status}">${status}</span>`;
}

const taskPageSize = 10;
const runPageSize = 10;
let taskPage = 1;
let allTasks = [];
const runPages = new Map();
let pendingTaskLoad = null;
let candidateModal = null;
let taskEditModal = null;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanOptionalText(value) {
  const text = String(value || "").trim();
  return ["null", "undefined"].includes(text.toLowerCase()) ? "" : text;
}

function sanitizeOptionalFields() {
  ["#proxyUrl", "#cookies", "#editProxyUrl", "#editCookies"].forEach((selector) => {
    const $field = $(selector);
    if ($field.length) {
      $field.val(cleanOptionalText($field.val()));
    }
  });
}

async function deleteTask(taskId) {
  allTasks = allTasks.filter((task) => String(task._id) !== String(taskId));
  runPages.delete(String(taskId));
  renderTasks();
  await $.ajax({ method: "DELETE", url: `/api/tasks/${encodeURIComponent(taskId)}` });
}

async function retryRun(taskId, runIndex) {
  const task = allTasks.find((item) => String(item._id) === String(taskId));
  if (task && task.runs && task.runs[runIndex]) {
    task.runs[runIndex].status = "running";
    task.runs[runIndex].error = "";
    task.status = "running";
    renderTasks();
  }

  await $.ajax({
    method: "POST",
    url: `/api/tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runIndex)}/retry`
  });
}

async function updateTask(taskId, payload) {
  await $.ajax({
    method: "PUT",
    url: `/api/tasks/${encodeURIComponent(taskId)}`,
    contentType: "application/json",
    data: JSON.stringify(payload)
  });
}

function canRetryRun(run) {
  return run.status !== "clicked" && run.status !== "running" && run.status !== "queued";
}

function canInspectCandidates(run) {
  return run.status !== "clicked";
}

function findTaskRun(taskId, runIndex) {
  const task = allTasks.find((item) => String(item._id) === String(taskId));
  if (!task || !task.runs) return { task: null, run: null };
  return { task, run: task.runs[Number(runIndex)] || null };
}

function renderCandidateList(candidates) {
  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftPage = Number(left.pageNumber || 0);
    const rightPage = Number(right.pageNumber || 0);
    if (leftPage !== rightPage) return leftPage - rightPage;
    return String(left.href || "").localeCompare(String(right.href || ""));
  });

  if (!sortedCandidates.length) {
    return `
      <div class="empty-state">
        Bu run sırasında aday adres kaydı yok. Google sonuç sayfası yerine challenge, captcha veya hata sayfası dönmüş olabilir.
      </div>
    `;
  }

  return `
    <div class="candidate-list">
      ${sortedCandidates.map((candidate) => `
        <div class="candidate-row">
          <div>
            <div class="candidate-host">${escapeHtml(candidate.host)}${candidate.pageNumber ? ` · page ${escapeHtml(candidate.pageNumber)}` : ""}</div>
            <div class="candidate-text">${escapeHtml(candidate.text || candidate.path || "")}</div>
          </div>
          <a href="${escapeHtml(candidate.href)}" target="_blank" rel="noreferrer">${escapeHtml(candidate.href)}</a>
        </div>
      `).join("")}
    </div>
  `;
}

function showCandidateModal(taskId, runIndex) {
  const { task, run } = findTaskRun(taskId, runIndex);
  if (!task || !run) return;

  const candidates = run.candidates || [];
  $("#candidateModalTitle").text(`${task.targetAddress} · ${run.keyword}`);
  $("#candidateModalBody").html(`
    <div class="candidate-summary">
      <span>target: ${escapeHtml(task.targetAddress)}</span>
      <span>keyword: ${escapeHtml(run.keyword)}</span>
      <span>status: ${escapeHtml(run.status)}</span>
      <span>attempts: ${escapeHtml(run.attempts || 0)}/${escapeHtml(task.maxAttempts || 3)}</span>
      <span>${candidates.length} adres</span>
    </div>
    ${renderCandidateList(candidates)}
  `);
  candidateModal.show();
}

function showTaskEditModal(taskId) {
  const task = allTasks.find((item) => String(item._id) === String(taskId));
  if (!task) return;

  $("#editTaskId").val(taskId);
  $("#editKeywords").val((task.keywords || []).join("\n"));
  $("#editTargetAddress").val(task.targetAddress || "");
  $("#editCount").val(task.count || 1);
  $("#editDurationHours").val(Number(task.durationHours || 0));
  $("#editMaxAttempts").val(Number(task.maxAttempts || 3));
  $("#editHeadless").prop("checked", Boolean(task.headless));
  $("#editDeviceMode").val(task.deviceMode || "desktop");
  $("#editProxyUrl").val(cleanOptionalText(task.proxyUrl));
  $("#editCookies").val((task.cookies || []).length ? JSON.stringify(task.cookies, null, 2) : "");
  taskEditModal.show();
}

function readTaskEditPayload() {
  return {
    keywords: $("#editKeywords").val(),
    targetAddress: $("#editTargetAddress").val(),
    clickCount: Number($("#editCount").val()),
    maxAttempts: Number($("#editMaxAttempts").val()),
    durationHours: Number($("#editDurationHours").val()),
    headless: $("#editHeadless").is(":checked"),
    deviceMode: $("#editDeviceMode").val(),
    proxyUrl: cleanOptionalText($("#editProxyUrl").val()),
    cookies: cleanOptionalText($("#editCookies").val())
  };
}

function clampPage(page, totalPages) {
  return Math.min(Math.max(Number(page) || 1, 1), Math.max(totalPages, 1));
}

function renderPager({ page, totalItems, pageSize, target, itemLabel }) {
  const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
  if (totalPages <= 1) {
    return `<div class="pager-summary">${totalItems} ${itemLabel}</div>`;
  }

  return `
    <div class="pager" data-pager="${escapeHtml(target)}">
      <span class="pager-summary">${totalItems} ${itemLabel} · ${page}/${totalPages}</span>
      <div class="btn-group btn-group-sm" role="group">
        <button class="btn btn-outline-secondary" type="button" data-page-target="${escapeHtml(target)}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Önceki</button>
        <button class="btn btn-outline-secondary" type="button" data-page-target="${escapeHtml(target)}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Sonraki</button>
      </div>
    </div>
  `;
}

function renderTask(task) {
  const percent = task.count ? Math.round((task.progress / task.count) * 100) : 0;
  const runs = task.runs || [];
  const taskId = String(task._id);
  const runTotalPages = Math.max(Math.ceil(runs.length / runPageSize), 1);
  const runPage = clampPage(runPages.get(taskId) || 1, runTotalPages);
  runPages.set(taskId, runPage);
  const runStart = (runPage - 1) * runPageSize;
  const visibleRuns = runs.slice(runStart, runStart + runPageSize);
  const renderedRuns = visibleRuns.map((run, offset) => {
    const runIndex = runStart + offset;
    const retryButton = canRetryRun(run)
      ? `<button class="btn btn-outline-primary btn-sm run-retry-btn" type="button" data-retry-task="${escapeHtml(taskId)}" data-retry-run="${runIndex}">Retry</button>`
      : "";
    const candidateButton = canInspectCandidates(run)
      ? `<button class="btn btn-outline-secondary btn-sm run-candidate-btn" type="button" data-candidate-task="${escapeHtml(taskId)}" data-candidate-run="${runIndex}">Adresler</button>`
      : "";

    return `
    <div class="run-row">
      <span>${escapeHtml(run.keyword)}</span>
      <span class="run-status-cell">${statusBadge(run.status)}${retryButton}${candidateButton}</span>
      <span>${run.matchedUrl ? `<a href="${escapeHtml(run.matchedUrl)}" target="_blank" rel="noreferrer">${escapeHtml(run.matchedUrl)}</a>${run.resultPage ? ` · page ${run.resultPage}` : ""}${run.resultRank ? ` · rank ${run.resultRank}` : ""}` : escapeHtml(run.error || (run.scheduledAt ? `scheduled ${new Date(run.scheduledAt).toLocaleString()}` : "-"))}</span>
    </div>
  `;
  }).join("");

  return `
    <article class="task-card">
      <div class="d-flex flex-wrap justify-content-between gap-2">
        <div>
          <div class="fw-semibold">${escapeHtml(task.targetAddress)}</div>
          <div class="task-meta">${escapeHtml(task.keywords.join(", "))}</div>
        </div>
        <div class="d-flex gap-2 align-items-start">
          <button class="btn btn-outline-secondary btn-sm" data-edit-task="${escapeHtml(taskId)}" type="button">Düzenle</button>
          <button class="btn btn-outline-danger btn-sm" data-delete-task="${escapeHtml(taskId)}" type="button">Sil</button>
          <div>${statusBadge(task.status)}</div>
        </div>
      </div>
      <div class="task-meta mt-2">
        ${task.count} click · ${Number(task.durationHours || 0)} saat · ${task.headless ? "headless" : "visible"} · ${task.deviceMode || "desktop"} · ${task.proxyUrl ? "proxy" : "direct"} · ${(task.cookies || []).length} cookie · ${new Date(task.createdAt).toLocaleString()}
        · retry ${task.maxAttempts || 3}
      </div>
      <div class="progress mt-3" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar" style="width:${percent}%">${percent}%</div>
      </div>
      ${runs.length ? `
        <div class="run-list">${renderedRuns}</div>
        ${renderPager({ page: runPage, totalItems: runs.length, pageSize: runPageSize, target: `runs:${taskId}`, itemLabel: "run" })}
      ` : ""}
    </article>
  `;
}

function renderTasks() {
  const totalPages = Math.max(Math.ceil(allTasks.length / taskPageSize), 1);
  taskPage = clampPage(taskPage, totalPages);
  const start = (taskPage - 1) * taskPageSize;
  const visibleTasks = allTasks.slice(start, start + taskPageSize);

  $("#tasks").html(visibleTasks.length ? visibleTasks.map(renderTask).join("") : '<div class="empty-state">Henüz task yok.</div>');
  $("#taskPager").html(renderPager({
    page: taskPage,
    totalItems: allTasks.length,
    pageSize: taskPageSize,
    target: "tasks",
    itemLabel: "task"
  }));
}

async function loadTasks() {
  allTasks = await $.getJSON("/api/tasks");
  renderTasks();
}

function scheduleLoadTasks() {
  if (pendingTaskLoad) return;

  pendingTaskLoad = setTimeout(() => {
    pendingTaskLoad = null;
    loadTasks();
  }, 250);
}

function renderLog(log) {
  const meta = log.meta && Object.keys(log.meta).length ? `<pre>${escapeHtml(JSON.stringify(log.meta, null, 2))}</pre>` : "";
  return `
    <div class="log-row log-${escapeHtml(log.level)}">
      <span>${escapeHtml(log.level)}</span>
      <span>${new Date(log.createdAt).toLocaleString()}</span>
      <span>${escapeHtml(log.message)}${meta}</span>
    </div>
  `;
}

async function loadLogs() {
  const level = $("#logLevel").val();
  const logs = await $.getJSON(`/api/logs?limit=200${level ? `&level=${encodeURIComponent(level)}` : ""}`);
  $("#logs").html(logs.length ? logs.map(renderLog).join("") : '<div class="text-secondary">Henüz log yok.</div>');
}

function prependLog(log) {
  const level = $("#logLevel").val();
  if (level && log.level !== level) return;

  const $logs = $("#logs");
  if ($logs.find(".text-secondary").length) {
    $logs.empty();
  }
  $logs.prepend(renderLog(log));
  $logs.children().slice(200).remove();
}

function renderErrorSummary(errors) {
  const latest = errors[0] ? new Date(errors[0].createdAt).toLocaleString() : "-";
  const http500 = errors.filter((log) => log.meta && Number(log.meta.statusCode) >= 500).length;
  return `
    <div class="metric"><span>Toplam</span><strong>${errors.length}</strong></div>
    <div class="metric"><span>HTTP 5xx</span><strong>${http500}</strong></div>
    <div class="metric"><span>Son hata</span><strong>${escapeHtml(latest)}</strong></div>
  `;
}

async function loadErrors() {
  const errors = await $.getJSON("/api/errors?limit=200");
  $("#errorSummary").html(renderErrorSummary(errors));
  $("#errors").html(errors.length ? errors.map(renderLog).join("") : '<div class="text-secondary">Kayıtlı sistem hatası yok.</div>');
}

async function checkHealth() {
  try {
    await $.getJSON("/api/health");
    $("#healthBadge").removeClass("text-bg-secondary text-bg-danger").addClass("text-bg-success").text("online");
  } catch (error) {
    $("#healthBadge").removeClass("text-bg-secondary text-bg-success").addClass("text-bg-danger").text("offline");
  }
}

$("#taskForm").on("submit", async function (event) {
  event.preventDefault();
  const $button = $("#createTaskBtn");
  $button.prop("disabled", true).text("Açılıyor...");

  try {
    await $.ajax({
      method: "POST",
      url: "/api/tasks",
      contentType: "application/json",
      data: JSON.stringify({
        keywords: $("#keywords").val(),
        targetAddress: $("#targetAddress").val(),
        clickCount: Number($("#count").val()),
        maxAttempts: Number($("#maxAttempts").val()),
        durationHours: Number($("#durationHours").val()),
        headless: $("#headless").is(":checked"),
        deviceMode: $("#deviceMode").val(),
        proxyUrl: cleanOptionalText($("#proxyUrl").val()),
        cookies: cleanOptionalText($("#cookies").val())
      })
    });
    await loadTasks();
  } catch (xhr) {
    alert((xhr.responseJSON && xhr.responseJSON.error) || "Task oluşturulamadı");
  } finally {
    $button.prop("disabled", false).text("Task aç");
  }
});

$("#tasks").on("click", "[data-delete-task]", function () {
  deleteTask($(this).data("delete-task")).catch((error) => {
    alert((error.responseJSON && error.responseJSON.error) || "Task silinemedi");
    scheduleLoadTasks();
  });
});
$("#tasks").on("click", "[data-retry-task]", function () {
  const $button = $(this);
  $button.prop("disabled", true).text("Retry...");
  retryRun($button.data("retry-task"), Number($button.data("retry-run"))).catch((error) => {
    alert((error.responseJSON && error.responseJSON.error) || "Run retry başlatılamadı");
    scheduleLoadTasks();
  });
});
$("#tasks").on("click", "[data-candidate-task]", function () {
  showCandidateModal($(this).data("candidate-task"), Number($(this).data("candidate-run")));
});
$("#tasks").on("click", "[data-edit-task]", function () {
  showTaskEditModal($(this).data("edit-task"));
});
$("#taskEditForm").on("submit", async function (event) {
  event.preventDefault();
  const taskId = $("#editTaskId").val();
  const $button = $("#taskEditSaveBtn");
  $button.prop("disabled", true).text("Kaydediliyor...");

  try {
    await updateTask(taskId, readTaskEditPayload());
    taskEditModal.hide();
    await loadTasks();
  } catch (xhr) {
    alert((xhr.responseJSON && xhr.responseJSON.error) || "Task güncellenemedi");
  } finally {
    $button.prop("disabled", false).text("Kaydet ve yeniden başlat");
  }
});
$(document).on("click", "[data-page-target]", function () {
  const target = String($(this).data("page-target"));
  const nextPage = Number($(this).data("page"));
  if (target === "tasks") {
    taskPage = nextPage;
    renderTasks();
    return;
  }

  if (target.startsWith("runs:")) {
    runPages.set(target.slice(5), nextPage);
    renderTasks();
  }
});
$("#logLevel").on("change", loadLogs);

function setStreamState(online) {
  $("#taskLiveState, #logLiveState, #errorLiveState")
    .toggleClass("is-offline", !online)
    .text(online ? "live" : "reconnecting");
}

const events = new EventSource("/api/events");
events.addEventListener("connected", () => setStreamState(true));
events.addEventListener("open", () => setStreamState(true));
events.addEventListener("heartbeat", () => setStreamState(true));
events.addEventListener("error", () => setStreamState(false));
events.addEventListener("task.updated", scheduleLoadTasks);
events.addEventListener("task.deleted", (event) => {
  const payload = JSON.parse(event.data);
  allTasks = allTasks.filter((task) => String(task._id) !== String(payload.taskId));
  runPages.delete(String(payload.taskId));
  renderTasks();
});
events.addEventListener("completed", scheduleLoadTasks);
events.addEventListener("failed", scheduleLoadTasks);
events.addEventListener("progress", scheduleLoadTasks);
events.addEventListener("log.created", (event) => {
  const log = JSON.parse(event.data);
  prependLog(log);
  if (log.level === "error") {
    loadErrors();
  }
});

candidateModal = new bootstrap.Modal(document.getElementById("candidateModal"));
taskEditModal = new bootstrap.Modal(document.getElementById("taskEditModal"));
sanitizeOptionalFields();
checkHealth();
loadTasks();
loadLogs();
loadErrors();
