function statusBadge(status) {
  return `<span class="status-pill status-${status}">${status}</span>`;
}

const taskPageSize = 10;
const runPageSize = 10;
let taskPage = 1;
let allTasks = [];
let allCookies = [];
let allGoogleAuthAccounts = [];
let allGmailCreatorJobs = [];
let browserCapacity = null;
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

function extractAjaxErrorMessage(error, fallbackMessage) {
  const statusText = error && error.status ? `HTTP ${error.status}` : "";
  const jsonError = error && error.responseJSON && error.responseJSON.error;
  const jsonDetails = error && error.responseJSON && error.responseJSON.details;
  const textError = error && typeof error.responseText === "string" ? error.responseText.trim() : "";
  const nativeError = error && error.message;
  const message = jsonError || textError || nativeError || fallbackMessage;
  const details = Array.isArray(jsonDetails) ? jsonDetails.join("\n") : (jsonDetails || "");

  return [statusText, message, details].filter(Boolean).join("\n");
}

function proxyGroupFor(scope) {
  return $(`[data-proxy-builder="${scope}"]`);
}

function proxyUrlInputFor(scope) {
  return $(`[data-proxy-url="${scope}"]`);
}

function proxyPreviewFor(scope) {
  return $(`[data-proxy-preview="${scope}"]`);
}

function proxyFieldFor(scope, field) {
  return proxyGroupFor(scope).find(`[data-proxy-field="${field}"]`);
}

function encodeProxyCredential(value) {
  return encodeURIComponent(cleanOptionalText(value));
}

function decodeProxyCredential(value) {
  try {
    return decodeURIComponent(value || "");
  } catch (error) {
    return value || "";
  }
}

function setProxyPreview(scope, text, state) {
  proxyPreviewFor(scope)
    .removeClass("is-ready is-warn")
    .addClass(state ? `is-${state}` : "")
    .text(text);
}

function buildProxyUrlFromParts(scope) {
  const protocol = cleanOptionalText(proxyFieldFor(scope, "protocol").val()) || "socks5";
  const host = cleanOptionalText(proxyFieldFor(scope, "host").val());
  const port = cleanOptionalText(proxyFieldFor(scope, "port").val());
  const username = cleanOptionalText(proxyFieldFor(scope, "username").val());
  const password = cleanOptionalText(proxyFieldFor(scope, "password").val());

  if (!host && !port && !username && !password) return "";
  if (!host || !port) return null;

  const auth = username
    ? `${encodeProxyCredential(username)}${password ? `:${encodeProxyCredential(password)}` : ""}@`
    : "";

  return `${protocol}://${auth}${host}:${port}`;
}

function parseProxyUrlToParts(value) {
  const text = cleanOptionalText(value);
  if (!text) return null;

  try {
    const parsed = new URL(text);
    const protocol = parsed.protocol.replace(":", "") === "socks"
      ? "socks5"
      : parsed.protocol.replace(":", "");

    return {
      protocol,
      host: parsed.hostname,
      port: parsed.port,
      username: decodeProxyCredential(parsed.username),
      password: decodeProxyCredential(parsed.password)
    };
  } catch (error) {
    return null;
  }
}

function setProxyBuilderFromUrl(scope, value) {
  const parts = parseProxyUrlToParts(value);
  if (!parts) {
    if (cleanOptionalText(value)) {
      setProxyPreview(scope, "Proxy URL formatı eksik. Örn: socks5://user:pass@host:port", "warn");
      return;
    }
    proxyFieldFor(scope, "host").val("");
    proxyFieldFor(scope, "port").val("");
    proxyFieldFor(scope, "username").val("");
    proxyFieldFor(scope, "password").val("");
    syncProxyPreview(scope);
    return;
  }

  proxyFieldFor(scope, "protocol").val(parts.protocol || "socks5");
  proxyFieldFor(scope, "host").val(parts.host || "");
  proxyFieldFor(scope, "port").val(parts.port || "");
  proxyFieldFor(scope, "username").val(parts.username || "");
  proxyFieldFor(scope, "password").val(parts.password || "");
  syncProxyPreview(scope);
}

function syncProxyPreview(scope) {
  const builtUrl = buildProxyUrlFromParts(scope);
  const rawUrl = cleanOptionalText(proxyUrlInputFor(scope).val());

  if (builtUrl) {
    setProxyPreview(scope, builtUrl, "ready");
    return;
  }

  if (builtUrl === null) {
    setProxyPreview(scope, "Host ve port gerekli.", "warn");
    return;
  }

  setProxyPreview(scope, rawUrl || "Proxy boş.", rawUrl ? "ready" : "");
}

function applyProxyBuilder(scope) {
  const builtUrl = buildProxyUrlFromParts(scope);
  if (builtUrl) {
    proxyUrlInputFor(scope).val(builtUrl);
  }
  syncProxyPreview(scope);
}

function renderBrowserCapacityHint(scope) {
  const $hint = $(`[data-browser-capacity-hint="${scope}"]`);
  if (!browserCapacity) {
    $hint.text("Tarayıcı kapasitesi hesaplanıyor...");
    return;
  }

  $hint.text(
    `Öneri: ${browserCapacity.recommended} · üst sınır: ${browserCapacity.maxAllowed} · CPU: ${browserCapacity.cpuCores} çekirdek · boş RAM: ${browserCapacity.freeMemoryMb} MB`
  );
}

function applyBrowserCapacity(scope) {
  if (!browserCapacity) return;
  const selector = scope === "edit" ? "#editMaxConcurrentBrowsers" : "#maxConcurrentBrowsers";
  $(selector)
    .attr("max", browserCapacity.maxAllowed)
    .val(browserCapacity.recommended);
  renderBrowserCapacityHint(scope);
}

async function loadBrowserCapacity() {
  try {
    browserCapacity = await $.getJSON("/api/system/browser-capacity");
    ["create", "edit"].forEach((scope) => {
      const selector = scope === "edit" ? "#editMaxConcurrentBrowsers" : "#maxConcurrentBrowsers";
      $(selector).attr("max", browserCapacity.maxAllowed);
      renderBrowserCapacityHint(scope);
    });
    if (!Number($("#maxConcurrentBrowsers").val()) || Number($("#maxConcurrentBrowsers").val()) <= 2) {
      applyBrowserCapacity("create");
    }
  } catch (error) {
    $('[data-browser-capacity-hint]').text("Tarayıcı kapasitesi alınamadı. Varsayılan 1 kullanılacak.");
  }
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Cookie dosyası okunamadı"));
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",").pop() : value);
    };
    reader.onerror = () => reject(reader.error || new Error("Dosya okunamadı"));
    reader.readAsDataURL(file);
  });
}

function isSpreadsheetFile(file) {
  const name = String(file && file.name || "").toLowerCase();
  const type = String(file && file.type || "").toLowerCase();
  return name.endsWith(".xlsx")
    || name.endsWith(".xls")
    || type.includes("spreadsheet")
    || type.includes("excel");
}

function cookieGroupFor(scope) {
  return $(`[data-cookie-input-group="${scope}"]`);
}

function selectedCookieSource(scope) {
  const $group = cookieGroupFor(scope);
  return $group.find('input[type="radio"]:checked').val() || "text";
}

function syncCookieSource(scope) {
  const $group = cookieGroupFor(scope);
  const source = selectedCookieSource(scope);
  $group.find("[data-cookie-text]").toggleClass("d-none", source !== "text");
  $group.find("[data-cookie-file]").toggleClass("d-none", source !== "file");
  if (source === "pool") {
    $group.find("[data-cookie-file-name]").text("Aktif cookie havuzu kullanılacak. Broken/disabled cookieler seçilmez.");
  } else if ($group.find("[data-cookie-file-name]").text().includes("Aktif cookie havuzu")) {
    $group.find("[data-cookie-file-name]").text("");
  }
}

async function readCookieInput(scope) {
  const $group = cookieGroupFor(scope);
  const source = selectedCookieSource(scope);
  if (source === "pool") {
    return { cookies: "", cookieSets: [], useCookiePool: true };
  }
  if (source !== "file") {
    return { cookies: cleanOptionalText($group.find("[data-cookie-text]").val()), useCookiePool: false };
  }

  const files = Array.from($group.find("[data-cookie-file]")[0].files || []);
  if (!files.length) return { cookies: "", cookieSets: [], useCookiePool: false };

  const cookieSets = await Promise.all(files.map(async (file) => ({
    name: file.name,
    content: cleanOptionalText(await readTextFile(file))
  })));

  return { cookies: "", cookieSets, useCookiePool: false };
}

function resetCookieFile(scope) {
  const $group = cookieGroupFor(scope);
  $group.find("[data-cookie-file]").val("");
  $group.find("[data-cookie-file-name]").text("");
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

function renderCandidateEmptyState(run) {
  if (run.googleBlocked) {
    return "Google bu run sırasında challenge/captcha/sorry sayfası döndürdü. Cookie veya IP değiştirmek gerekir.";
  }

  if (String(run.error || "").toLowerCase().includes("hiçbir sonuç") || String(run.error || "").toLowerCase().includes("no results")) {
    return "Google bu sorgu için kendi sayfasında hiçbir sonuç bulunamadığını gösterdi.";
  }

  return "Bu run sırasında aday adres kaydı yok. Google farklı bir SERP varyasyonu, consent/challenge veya parser dışı bir sonuç formatı döndürmüş olabilir.";
}

function renderCandidateList(candidates, run = {}) {
  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftPage = Number(left.pageNumber || 0);
    const rightPage = Number(right.pageNumber || 0);
    if (leftPage !== rightPage) return leftPage - rightPage;
    return String(left.href || "").localeCompare(String(right.href || ""));
  });

  if (!sortedCandidates.length) {
    return `
      <div class="empty-state">
        ${escapeHtml(renderCandidateEmptyState(run))}
        ${run.lastGoogleUrl ? `<div class="task-meta mt-2">Son Google URL: ${escapeHtml(run.lastGoogleUrl)}</div>` : ""}
        ${run.error ? `<div class="task-meta mt-1">Detay: ${escapeHtml(run.error)}</div>` : ""}
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
    ${renderCandidateList(candidates, run)}
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
  $("#editMaxConcurrentBrowsers").val(Number(task.maxConcurrentBrowsers || 2));
  $("#editHeadless").prop("checked", Boolean(task.headless));
  $("#editDeviceMode").val(task.deviceMode || "desktop");
  $("#editProxyUrl").val(cleanOptionalText(task.proxyUrl));
  setProxyBuilderFromUrl("edit", task.proxyUrl);
  $("#editCookies").val((task.cookieSets || []).length
    ? JSON.stringify({ cookieSets: task.cookieSets }, null, 2)
    : ((task.cookies || []).length ? JSON.stringify(task.cookies, null, 2) : ""));
  if (task.useCookiePool) {
    $("#editCookieSourcePool").prop("checked", true);
  } else {
    $("#editCookieSourceText").prop("checked", true);
  }
  resetCookieFile("edit");
  syncCookieSource("edit");
  taskEditModal.show();
}

async function readTaskEditPayload() {
  const cookiePayload = await readCookieInput("edit");
  return {
    keywords: $("#editKeywords").val(),
    targetAddress: $("#editTargetAddress").val(),
    clickCount: Number($("#editCount").val()),
    maxConcurrentBrowsers: Number($("#editMaxConcurrentBrowsers").val()),
    maxAttempts: Number($("#editMaxAttempts").val()),
    durationHours: Number($("#editDurationHours").val()),
    headless: $("#editHeadless").is(":checked"),
    deviceMode: $("#editDeviceMode").val(),
    proxyUrl: cleanOptionalText($("#editProxyUrl").val()),
    ...cookiePayload
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
  const cookieSets = task.cookieSets || [];
  const cookieCount = cookieSets.length
    ? cookieSets.reduce((total, cookieSet) => total + ((cookieSet.cookies || []).length), 0)
    : (task.cookies || []).length;
  const cookieSummary = cookieSets.length
    ? `${cookieCount} cookie / ${cookieSets.length} set`
    : (task.useCookiePool ? "cookie havuzu" : `${cookieCount} cookie`);
  const taskId = String(task._id);
  const runTotalPages = Math.max(Math.ceil(runs.length / runPageSize), 1);
  const runPage = clampPage(runPages.get(taskId) || 1, runTotalPages);
  runPages.set(taskId, runPage);
  const runStart = (runPage - 1) * runPageSize;
  const visibleRuns = runs.slice(runStart, runStart + runPageSize);
  const renderedRuns = visibleRuns.map((run, offset) => {
    const runIndex = runStart + offset;
    const cookieInfo = run.cookieSetName
      ? `Cookie: ${run.cookieSetName}${Number.isInteger(run.cookieSetIndex) ? ` (${run.cookieSetIndex + 1}/${run.cookieSetCount || "?"})` : ""}`
      : `Cookie: ${(task.cookies || []).length ? "tek cookie set" : "-"}`;
    const proxyInfo = task.proxyUrl
      ? `IP: ${run.proxyExitIp || (run.proxyExitIpError ? `kontrol hatası` : "kontrol ediliyor")}${run.proxyHost ? ` · ${run.proxyHost}` : ""}`
      : "IP: direct";
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
      <span>
        <span class="run-target-line">${run.matchedUrl ? `<a href="${escapeHtml(run.matchedUrl)}" target="_blank" rel="noreferrer">${escapeHtml(run.matchedUrl)}</a>${run.resultPage ? ` · page ${run.resultPage}` : ""}${run.resultRank ? ` · rank ${run.resultRank}` : ""}` : escapeHtml(run.error || (run.scheduledAt ? `scheduled ${new Date(run.scheduledAt).toLocaleString()}` : "-"))}</span>
        <span class="run-debug-line">${escapeHtml(cookieInfo)} · ${escapeHtml(proxyInfo)}${run.proxyExitIpError ? ` · ${escapeHtml(run.proxyExitIpError)}` : ""}</span>
      </span>
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
        ${task.count} click · ${Number(task.durationHours || 0)} saat · eşzamanlı ${task.maxConcurrentBrowsers || 2} · ${task.headless ? "headless" : "visible"} · ${task.deviceMode || "desktop"} · ${task.proxyUrl ? "proxy" : "direct"} · ${cookieSummary} · ${new Date(task.createdAt).toLocaleString()}
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

function cookieStatusBadge(status) {
  return `<span class="status-pill status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function renderCookiePoolItem(cookie) {
  const cookieId = String(cookie._id);
  const cookieCount = (cookie.cookies || []).length;
  const lastUsed = cookie.lastUsedAt ? new Date(cookie.lastUsedAt).toLocaleString() : "-";
  const lastFailure = cookie.lastFailureAt ? new Date(cookie.lastFailureAt).toLocaleString() : "-";
  const statusAction = cookie.status === "active"
    ? `<button class="btn btn-outline-secondary btn-sm" type="button" data-cookie-status="${escapeHtml(cookieId)}" data-status="disabled">Pasifleştir</button>`
    : `<button class="btn btn-outline-success btn-sm" type="button" data-cookie-status="${escapeHtml(cookieId)}" data-status="active">Kullanıma aç</button>`;

  return `
    <div class="cookie-pool-row">
      <div>
        <div class="fw-semibold">${escapeHtml(cookie.name)}</div>
        <div class="task-meta">${cookieCount} cookie · fail ${Number(cookie.failureCount || 0)} · son kullanım ${escapeHtml(lastUsed)} · son hata ${escapeHtml(lastFailure)}</div>
        ${cookie.disabledReason ? `<div class="task-meta">${escapeHtml(cookie.disabledReason)}</div>` : ""}
        ${cookie.lastExitIp ? `<div class="task-meta">son IP: ${escapeHtml(cookie.lastExitIp)}</div>` : ""}
      </div>
      <div>${cookieStatusBadge(cookie.status)}</div>
      <div class="cookie-pool-actions">
        ${statusAction}
        <button class="btn btn-outline-warning btn-sm" type="button" data-cookie-status="${escapeHtml(cookieId)}" data-status="broken">Patlak işaretle</button>
        <button class="btn btn-outline-secondary btn-sm" type="button" data-cookie-edit="${escapeHtml(cookieId)}">Düzenle</button>
        <button class="btn btn-outline-danger btn-sm" type="button" data-cookie-delete="${escapeHtml(cookieId)}">Sil</button>
      </div>
    </div>
  `;
}

function renderCookiePool() {
  $("#cookies").html(allCookies.length ? allCookies.map(renderCookiePoolItem).join("") : '<div class="empty-state">Cookie havuzu boş.</div>');
}

async function loadCookies() {
  allCookies = await $.getJSON("/api/cookies");
  renderCookiePool();
}

async function importCookiePoolFiles() {
  const files = Array.from($("#cookiePoolFiles")[0].files || []);
  if (!files.length) throw new Error("En az bir cookie dosyası seç");

  const cookieSets = await Promise.all(files.map(async (file) => ({
    name: file.name,
    content: cleanOptionalText(await readTextFile(file))
  })));

  await $.ajax({
    method: "POST",
    url: "/api/cookies",
    contentType: "application/json",
    data: JSON.stringify({
      targetAddress: cleanOptionalText($("#cookiePoolTargetAddress").val()) || "google.com",
      notes: cleanOptionalText($("#cookiePoolNotes").val()),
      cookieSets
    })
  });
}

async function updateCookieStatus(cookieId, status) {
  const reason = status === "active" ? "" : prompt("Sebep / not", status === "broken" ? "Google blocked" : "Manuel pasif") || "";
  await $.ajax({
    method: "PATCH",
    url: `/api/cookies/${encodeURIComponent(cookieId)}/status`,
    contentType: "application/json",
    data: JSON.stringify({ status, reason })
  });
}

async function editCookiePoolItem(cookieId) {
  const cookie = allCookies.find((item) => String(item._id) === String(cookieId));
  if (!cookie) return;

  const name = prompt("Cookie adı", cookie.name || "");
  if (!name) return;
  const notes = prompt("Not", cookie.notes || "") || "";

  await $.ajax({
    method: "PUT",
    url: `/api/cookies/${encodeURIComponent(cookieId)}`,
    contentType: "application/json",
    data: JSON.stringify({ name, notes })
  });
}

async function deleteCookiePoolItem(cookieId) {
  if (!confirm("Cookie havuzdan silinsin mi?")) return;
  await $.ajax({ method: "DELETE", url: `/api/cookies/${encodeURIComponent(cookieId)}` });
}

// Son üretimi durduran Google challenge'ını insanca bir rozete çevirir. phone_verification, hesabın
// pratikte yandığını gösterir (otomasyonla geçilemez).
function googleAuthChallengeBadge(challenge) {
  const map = {
    phone_verification: { label: "📵 telefon doğrulama · yanmış", cls: "google-auth-challenge-burned" },
    recaptcha_challenge: { label: "🤖 captcha takıldı", cls: "google-auth-challenge-warn" },
    "2fa_challenge": { label: "🔐 2FA takıldı", cls: "google-auth-challenge-warn" },
    unsafe_browser: { label: "⚠️ güvensiz tarayıcı", cls: "google-auth-challenge-warn" }
  };
  const entry = map[challenge];
  if (!entry) return "";
  return `<span class="google-auth-challenge ${entry.cls}">${entry.label}</span>`;
}

function renderGoogleAuthAccount(account) {
  const accountId = String(account._id || account.id);
  const lastGenerated = account.lastCookieGeneratedAt ? new Date(account.lastCookieGeneratedAt).toLocaleString() : "-";
  const cookieDownloadUrl = `/api/google-auth/${encodeURIComponent(accountId)}/cookies/download`;
  const secretFlags = [
    account.hasPassword ? "şifre var" : "şifre yok",
    account.hasTwoFaSecret ? "2FA var" : "2FA yok",
    account.recoveryEmail ? "recovery var" : "recovery yok"
  ].join(" · ");

  return `
    <div class="google-auth-row">
      <div>
        <div class="fw-semibold">${escapeHtml(account.email)}${account.source === "created" ? ' <span class="badge text-bg-info">bot</span>' : ""}</div>
        <div class="task-meta">${escapeHtml(secretFlags)} · son üretim ${escapeHtml(lastGenerated)}</div>
        ${account.proxyUrl ? `<div class="task-meta google-auth-file-path">proxy: ${escapeHtml(account.proxyUrl)}</div>` : ""}
        ${account.lastCookiePoolId ? `<div class="task-meta">cookie: ${escapeHtml(account.lastCookiePoolId)}</div>` : ""}
        ${account.lastCookieFileName ? `<div class="task-meta">dosya: ${escapeHtml(account.lastCookieFileName)}</div>` : ""}
        ${account.lastCookieFilePath ? `<div class="task-meta google-auth-file-path">dosya yolu: ${escapeHtml(account.lastCookieFilePath)}</div>` : ""}
        ${account.lastError ? `<div class="task-meta text-danger">${escapeHtml(account.lastError)}</div>` : ""}
        ${account.notes ? `<div class="task-meta">${escapeHtml(account.notes)}</div>` : ""}
      </div>
      <div>${statusBadge(account.status || "active")}${googleAuthChallengeBadge(account.lastChallenge)}</div>
      <div class="google-auth-actions">
        <button class="btn btn-outline-primary btn-sm" type="button" data-google-auth-generate="${escapeHtml(accountId)}">Çerez üret</button>
        ${account.lastCookiePoolId ? `<a class="btn btn-outline-success btn-sm" href="${escapeHtml(cookieDownloadUrl)}">Dosya indir</a>` : ""}
        <button class="btn btn-outline-danger btn-sm" type="button" data-google-auth-delete="${escapeHtml(accountId)}">Sil</button>
      </div>
    </div>
  `;
}

function renderGoogleAuthAccounts() {
  $("#googleAuthAccounts").html(
    allGoogleAuthAccounts.length
      ? allGoogleAuthAccounts.map(renderGoogleAuthAccount).join("")
      : '<div class="empty-state">Google auth hesabı yok.</div>'
  );
}

async function loadGoogleAuthAccounts() {
  allGoogleAuthAccounts = await $.getJSON("/api/google-auth");
  renderGoogleAuthAccounts();
}

function resetGoogleAuthForm() {
  $("#googleAuthAccountId").val("");
  $("#googleAuthEmail").val("");
  $("#googleAuthPassword").val("").prop("required", true);
  $("#googleAuthTwoFaSecret").val("");
  $("#googleAuthAccountProxyUrl").val("");
  $("#googleAuthRecoveryEmail").val("");
  $("#googleAuthRecoveryPassword").val("");
  $("#googleAuthPhone").val("");
  $("#googleAuthNotes").val("");
  $("#googleAuthStatus").val("active");
  $("#googleAuthSaveBtn").text("Hesap kaydet");
  $("#googleAuthCancelEditBtn").addClass("d-none");
}

function readGoogleAuthPayload() {
  const accountId = cleanOptionalText($("#googleAuthAccountId").val());
  const payload = {
    email: cleanOptionalText($("#googleAuthEmail").val()),
    recoveryEmail: cleanOptionalText($("#googleAuthRecoveryEmail").val()),
    proxyUrl: cleanOptionalText($("#googleAuthAccountProxyUrl").val()),
    phone: cleanOptionalText($("#googleAuthPhone").val()),
    notes: cleanOptionalText($("#googleAuthNotes").val()),
    status: $("#googleAuthStatus").val()
  };

  const password = cleanOptionalText($("#googleAuthPassword").val());
  const recoveryPassword = cleanOptionalText($("#googleAuthRecoveryPassword").val());
  const twoFaSecret = cleanOptionalText($("#googleAuthTwoFaSecret").val());

  if (!accountId || password) payload.password = password;
  if (!accountId || recoveryPassword) payload.recoveryPassword = recoveryPassword;
  if (!accountId || twoFaSecret) payload.twoFaSecret = twoFaSecret;

  return payload;
}

function editGoogleAuthAccount(accountId) {
  const account = allGoogleAuthAccounts.find((item) => String(item._id || item.id) === String(accountId));
  if (!account) return;

  $("#googleAuthAccountId").val(accountId);
  $("#googleAuthEmail").val(account.email || "");
  $("#googleAuthPassword").val(account.password || "").prop("required", false);
  $("#googleAuthTwoFaSecret").val(account.twoFaSecret || "");
  $("#googleAuthAccountProxyUrl").val(account.proxyUrl || "");
  $("#googleAuthRecoveryEmail").val(account.recoveryEmail || "");
  $("#googleAuthRecoveryPassword").val(account.recoveryPassword || "");
  $("#googleAuthPhone").val(account.phone || "");
  $("#googleAuthNotes").val(account.notes || "");
  $("#googleAuthStatus").val(account.status || "active");
  $("#googleAuthSaveBtn").text("Hesap güncelle");
  $("#googleAuthCancelEditBtn").removeClass("d-none");
}

async function saveGoogleAuthAccount() {
  const accountId = cleanOptionalText($("#googleAuthAccountId").val());
  const payload = readGoogleAuthPayload();
  const request = {
    method: accountId ? "PUT" : "POST",
    url: accountId ? `/api/google-auth/${encodeURIComponent(accountId)}` : "/api/google-auth",
    contentType: "application/json",
    data: JSON.stringify(payload)
  };
  await $.ajax(request);
}

async function deleteGoogleAuthAccount(accountId) {
  if (!confirm("Google auth hesabı silinsin mi?")) return;
  await $.ajax({ method: "DELETE", url: `/api/google-auth/${encodeURIComponent(accountId)}` });
}

async function deleteAllGoogleAuthAccounts() {
  if (!allGoogleAuthAccounts.length) {
    alert("Silinecek Google auth hesabı yok.");
    return;
  }
  if (!confirm(`${allGoogleAuthAccounts.length} Google auth hesabı silinsin mi?`)) return;

  await $.ajax({ method: "DELETE", url: "/api/google-auth" });
  allGoogleAuthAccounts = [];
  renderGoogleAuthAccounts();
}

async function generateGoogleAuthAccountsSequentially(accounts) {
  const accountIds = accounts.map((account) => String(account._id || account.id)).filter(Boolean);
  let successCount = 0;
  let failedCount = 0;

  for (const accountId of accountIds) {
    try {
      await $.ajax({
        method: "POST",
        url: `/api/google-auth/${encodeURIComponent(accountId)}/cookies`,
        contentType: "application/json",
        data: JSON.stringify({
          headless: $("#googleAuthHeadless").is(":checked"),
          deviceMode: $("#googleAuthDeviceMode").val(),
          proxyUrl: cleanOptionalText($("#googleAuthProxyUrl").val()),
          captchaApiKey: cleanOptionalText($("#googleAuthCaptchaApiKey").val()),
          notes: `Google auth otomatik import üretimi · ${new Date().toLocaleString()}`
        })
      });
      successCount += 1;
    } catch (error) {
      failedCount += 1;
    } finally {
      await loadGoogleAuthAccounts();
      await loadCookies();
    }
  }

  return { successCount, failedCount };
}

async function importGoogleAuthAccounts() {
  const file = ($("#googleAuthImportFile")[0].files || [])[0];
  if (!file) {
    alert("CSV/TSV dosyası seç.");
    return;
  }

  const result = await $.ajax({
    method: "POST",
    url: "/api/google-auth/import",
    contentType: "application/json",
    data: JSON.stringify({
      content: isSpreadsheetFile(file) ? await readFileAsBase64(file) : await readTextFile(file),
      fileName: file.name || "",
      contentType: file.type || "",
      proxyUrl: cleanOptionalText($("#googleAuthProxyUrl").val()),
      autoGenerate: $("#googleAuthImportAutoGenerate").is(":checked")
    })
  });

  await loadGoogleAuthAccounts();
  if (!$("#googleAuthImportAutoGenerate").is(":checked")) {
    alert(`${result.importedCount || 0} Google hesabı import edildi.`);
    return;
  }

  const generated = await generateGoogleAuthAccountsSequentially(result.accounts || []);
  alert(`${result.importedCount || 0} hesap import edildi. Üretim: ${generated.successCount} başarılı, ${generated.failedCount} hatalı.`);
}

async function generateGoogleAuthCookies(accountId, button) {
  const proxyUrl = cleanOptionalText($("#googleAuthProxyUrl").val());
  const $button = $(button);
  const originalText = $button.text();
  $button.prop("disabled", true).text("Üretiliyor...");

  try {
    const result = await $.ajax({
      method: "POST",
      url: `/api/google-auth/${encodeURIComponent(accountId)}/cookies`,
      contentType: "application/json",
      data: JSON.stringify({
        headless: $("#googleAuthHeadless").is(":checked"),
        deviceMode: $("#googleAuthDeviceMode").val(),
        proxyUrl,
        captchaApiKey: cleanOptionalText($("#googleAuthCaptchaApiKey").val()),
        proxyResetUrl: cleanOptionalText($("#googleAuthProxyResetUrl").val()),
        maxAttempts: Number($("#googleAuthMaxAttempts").val()) || 3,
        notes: `Google auth UI üretimi · ${new Date().toLocaleString()}`
      })
    });
    await loadGoogleAuthAccounts();
    await loadCookies();
    alert(`${result.cookieCount || 0} Google cookie havuza ve dosyaya kaydedildi.`);
  } catch (error) {
    const serverMsg = (error && error.responseJSON && error.responseJSON.error) || (error && error.statusText) || "";
    let message;
    if (/recaptcha_required|recaptcha_unsolved|recaptcha_challenge/i.test(serverMsg)) {
      message = "Google captcha çıkardı. Headless'i KAPAT (görünür mod) ve captcha'yı elle çöz — akış devam edip çerezleri kaydeder. Bu hesaplar için tek güvenilir yol manuel çözüm.";
    } else if (/TUNNEL_CONNECTION_FAILED|tunnel|proxy/i.test(serverMsg)) {
      message = "Proxy bağlantısı kurulamadı (tünel hatası). 'Proxy' alanına çalışan proxy'i yaz: http://...@ankara8.buymobileproxy.com:8045";
    } else if (/unsafe_browser/i.test(serverMsg)) {
      message = "Google bu tarayıcıyı güvensiz buldu. Proxy/hesap değiştir veya görünür modda dene.";
    } else {
      message = `Üretim durdu: ${serverMsg || "bilinmeyen hata"}`;
    }
    alert(message);
  } finally {
    $button.prop("disabled", false).text(originalText);
  }
}

function gmailCreatorStatusBadge(status) {
  const map = {
    queued: { label: "queued", cls: "text-bg-secondary" },
    running: { label: "running", cls: "text-bg-primary" },
    awaiting_manual: { label: "elle müdahale", cls: "text-bg-warning" },
    completed: { label: "completed", cls: "text-bg-success" },
    failed: { label: "failed", cls: "text-bg-danger" }
  };
  const entry = map[status] || { label: status || "-", cls: "text-bg-secondary" };
  return `<span class="badge ${entry.cls}">${escapeHtml(entry.label)}</span>`;
}

function renderGmailCreatorJob(job) {
  const jobId = String(job._id || job.id);
  const createdAt = job.createdAt ? new Date(job.createdAt).toLocaleString() : "-";
  const identity = job.email
    ? escapeHtml(job.email)
    : `${escapeHtml(job.firstName || "")} ${escapeHtml(job.lastName || "")}`.trim() || "—";

  return `
    <div class="google-auth-row">
      <div>
        <div class="fw-semibold">${identity}</div>
        <div class="task-meta">${escapeHtml(job.firstName || "")} ${escapeHtml(job.lastName || "")} · ${escapeHtml(createdAt)}</div>
        ${job.password ? `<div class="task-meta">şifre kayıtlı · account: ${escapeHtml(job.accountId || "-")}</div>` : ""}
        ${job.manualHint ? `<div class="task-meta text-warning">${escapeHtml(job.manualHint)}</div>` : ""}
        ${job.lastError ? `<div class="task-meta text-danger">${escapeHtml(job.lastError)}</div>` : ""}
        ${job.proxyUrl ? `<div class="task-meta google-auth-file-path">proxy: ${escapeHtml(job.proxyUrl)}</div>` : ""}
      </div>
      <div>${gmailCreatorStatusBadge(job.status)}</div>
      <div class="google-auth-actions">
        ${job.status === "failed" ? `<button class="btn btn-outline-primary btn-sm" type="button" data-gmail-creator-retry="${escapeHtml(jobId)}">Tekrar dene</button>` : ""}
        <button class="btn btn-outline-danger btn-sm" type="button" data-gmail-creator-delete="${escapeHtml(jobId)}">Sil</button>
      </div>
    </div>
  `;
}

function renderGmailCreatorJobs() {
  $("#gmailCreatorJobs").html(
    allGmailCreatorJobs.length
      ? allGmailCreatorJobs.map(renderGmailCreatorJob).join("")
      : '<div class="empty-state">Gmail creator job yok.</div>'
  );
}

async function loadGmailCreatorJobs() {
  allGmailCreatorJobs = await $.getJSON("/api/gmail-creator");
  renderGmailCreatorJobs();
}

function toggleGmailCreatorProxyReset() {
  const proxy = String($("#gmailCreatorProxyUrl").val() || "").toLowerCase();
  $("#gmailCreatorProxyResetWrap").toggleClass("d-none", !proxy.includes("buymobileproxy"));
}

async function startGmailCreatorJobs() {
  const $button = $("#gmailCreatorStartBtn");
  const originalText = $button.text();
  $button.prop("disabled", true).text("Oluşturuluyor...");

  try {
    const result = await $.ajax({
      method: "POST",
      url: "/api/gmail-creator",
      contentType: "application/json",
      data: JSON.stringify({
        count: Number($("#gmailCreatorCount").val()) || 1,
        proxyUrl: cleanOptionalText($("#gmailCreatorProxyUrl").val()),
        proxyResetUrl: cleanOptionalText($("#gmailCreatorProxyResetUrl").val()),
        maxAttempts: Number($("#gmailCreatorMaxAttempts").val()) || 3,
        deviceMode: $("#gmailCreatorDeviceMode").val()
      })
    });
    await loadGmailCreatorJobs();
    await loadGoogleAuthAccounts();
    alert(`${result.successCount || 0} başarılı, ${result.failedCount || 0} hatalı. Tarayıcı açıkken captcha/telefon adımlarını elle tamamlayın.`);
  } catch (error) {
    alert(extractAjaxErrorMessage(error, "Gmail hesabı oluşturulamadı"));
    await loadGmailCreatorJobs();
  } finally {
    $button.prop("disabled", false).text(originalText);
  }
}

async function retryGmailCreatorJob(jobId, button) {
  const $button = $(button);
  const originalText = $button.text();
  $button.prop("disabled", true).text("Deneniyor...");

  try {
    await $.ajax({
      method: "POST",
      url: `/api/gmail-creator/${encodeURIComponent(jobId)}/retry`,
      contentType: "application/json",
      data: JSON.stringify({
        proxyUrl: cleanOptionalText($("#gmailCreatorProxyUrl").val()),
        proxyResetUrl: cleanOptionalText($("#gmailCreatorProxyResetUrl").val()),
        maxAttempts: Number($("#gmailCreatorMaxAttempts").val()) || 3,
        deviceMode: $("#gmailCreatorDeviceMode").val()
      })
    });
    await loadGmailCreatorJobs();
    await loadGoogleAuthAccounts();
  } catch (error) {
    alert(extractAjaxErrorMessage(error, "Gmail creator retry başarısız"));
    await loadGmailCreatorJobs();
  } finally {
    $button.prop("disabled", false).text(originalText);
  }
}

async function deleteGmailCreatorJob(jobId) {
  if (!confirm("Gmail creator job silinsin mi?")) return;
  await $.ajax({ method: "DELETE", url: `/api/gmail-creator/${encodeURIComponent(jobId)}` });
  await loadGmailCreatorJobs();
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
    const cookiePayload = await readCookieInput("create");
    await $.ajax({
      method: "POST",
      url: "/api/tasks",
      contentType: "application/json",
      data: JSON.stringify({
        keywords: $("#keywords").val(),
        targetAddress: $("#targetAddress").val(),
        clickCount: Number($("#count").val()),
        maxConcurrentBrowsers: Number($("#maxConcurrentBrowsers").val()),
        maxAttempts: Number($("#maxAttempts").val()),
        durationHours: Number($("#durationHours").val()),
        headless: $("#headless").is(":checked"),
        deviceMode: $("#deviceMode").val(),
        proxyUrl: cleanOptionalText($("#proxyUrl").val()),
        captchaApiKey: cleanOptionalText($("#captchaApiKey").val()),
        ...cookiePayload
      })
    });
    await loadTasks();
  } catch (xhr) {
    alert(extractAjaxErrorMessage(xhr, "Task oluşturulamadı"));
  } finally {
    $button.prop("disabled", false).text("Task aç");
  }
});

$("#tasks").on("click", "[data-delete-task]", function () {
  deleteTask($(this).data("delete-task")).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Task silinemedi"));
    scheduleLoadTasks();
  });
});
$("#tasks").on("click", "[data-retry-task]", function () {
  const $button = $(this);
  $button.prop("disabled", true).text("Retry...");
  retryRun($button.data("retry-task"), Number($button.data("retry-run"))).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Run retry başlatılamadı"));
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
    await updateTask(taskId, await readTaskEditPayload());
    taskEditModal.hide();
    await loadTasks();
  } catch (xhr) {
    alert(extractAjaxErrorMessage(xhr, "Task güncellenemedi"));
  } finally {
    $button.prop("disabled", false).text("Kaydet ve yeniden başlat");
  }
});
$("#cookieImportForm").on("submit", async function (event) {
  event.preventDefault();
  const $button = $("#cookieImportBtn");
  $button.prop("disabled", true).text("Yükleniyor...");

  try {
    await importCookiePoolFiles();
    $("#cookiePoolFiles").val("");
    $("#cookiePoolFileName").text("");
    await loadCookies();
  } catch (error) {
    alert(extractAjaxErrorMessage(error, "Cookie yüklenemedi"));
  } finally {
    $button.prop("disabled", false).text("Havuza yükle");
  }
});
$("#googleAuthAccountForm").on("submit", async function (event) {
  event.preventDefault();
  const $button = $("#googleAuthSaveBtn");
  $button.prop("disabled", true).text(cleanOptionalText($("#googleAuthAccountId").val()) ? "Güncelleniyor..." : "Kaydediliyor...");

  try {
    await saveGoogleAuthAccount();
    resetGoogleAuthForm();
    await loadGoogleAuthAccounts();
  } catch (error) {
    alert(extractAjaxErrorMessage(error, "Google auth hesabı kaydedilemedi"));
  } finally {
    $button.prop("disabled", false).text(cleanOptionalText($("#googleAuthAccountId").val()) ? "Hesap güncelle" : "Hesap kaydet");
  }
});
$("#googleAuthImportForm").on("submit", async function (event) {
  event.preventDefault();
  const $button = $("#googleAuthImportBtn");
  $button.prop("disabled", true).text($("#googleAuthImportAutoGenerate").is(":checked") ? "Import + üretim..." : "Import...");

  try {
    await importGoogleAuthAccounts();
    $("#googleAuthImportFile").val("");
    $("#googleAuthImportFileName").text("Kolonlar: gmail, şifre/sifre, 2fa · XLSX/CSV");
  } catch (error) {
    alert(extractAjaxErrorMessage(error, "Google auth import yapılamadı"));
  } finally {
    $button.prop("disabled", false).text("Dosyadan import");
  }
});
$("#googleAuthCancelEditBtn").on("click", resetGoogleAuthForm);
$("#googleAuthDeleteAllBtn").on("click", function () {
  const $button = $(this);
  $button.prop("disabled", true).text("Siliniyor...");
  deleteAllGoogleAuthAccounts().then(loadGoogleAuthAccounts).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Google auth hesapları silinemedi"));
  }).finally(() => {
    $button.prop("disabled", false).text("Tümünü sil");
  });
});
$("#googleAuthAccounts").on("click", "[data-google-auth-edit]", function () {
  editGoogleAuthAccount($(this).data("google-auth-edit"));
});
$("#googleAuthAccounts").on("click", "[data-google-auth-delete]", function () {
  deleteGoogleAuthAccount($(this).data("google-auth-delete")).then(loadGoogleAuthAccounts).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Google auth hesabı silinemedi"));
  });
});
$("#googleAuthAccounts").on("click", "[data-google-auth-generate]", function () {
  generateGoogleAuthCookies($(this).data("google-auth-generate"), this).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Google çerezi üretilemedi"));
    loadGoogleAuthAccounts();
  });
});
$("#gmailCreatorForm").on("submit", async function (event) {
  event.preventDefault();
  await startGmailCreatorJobs();
});
$(document).on("input", "#gmailCreatorProxyUrl", toggleGmailCreatorProxyReset);
$("#gmailCreatorJobs").on("click", "[data-gmail-creator-retry]", function () {
  retryGmailCreatorJob($(this).data("gmail-creator-retry"), this);
});
$("#gmailCreatorJobs").on("click", "[data-gmail-creator-delete]", function () {
  deleteGmailCreatorJob($(this).data("gmail-creator-delete")).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Gmail creator job silinemedi"));
  });
});
$("#googleAuthImportFile").on("change", function () {
  const file = (this.files || [])[0];
  $("#googleAuthImportFileName").text(file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : "Kolonlar: gmail, şifre/sifre, 2fa · XLSX/CSV");
});
$("#cookiePoolFiles").on("change", function () {
  const files = Array.from(this.files || []);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  $("#cookiePoolFileName").text(files.length ? `${files.length} dosya · ${Math.ceil(totalSize / 1024)} KB` : "");
});
$("#cookies").on("click", "[data-cookie-status]", function () {
  updateCookieStatus($(this).data("cookie-status"), String($(this).data("status"))).then(loadCookies).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Cookie durumu değiştirilemedi"));
  });
});
$("#cookies").on("click", "[data-cookie-edit]", function () {
  editCookiePoolItem($(this).data("cookie-edit")).then(loadCookies).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Cookie güncellenemedi"));
  });
});
$("#cookies").on("click", "[data-cookie-delete]", function () {
  deleteCookiePoolItem($(this).data("cookie-delete")).then(loadCookies).catch((error) => {
    alert(extractAjaxErrorMessage(error, "Cookie silinemedi"));
  });
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
$(document).on("change", ".cookie-source-toggle input", function () {
  syncCookieSource($(this).closest("[data-cookie-input-group]").data("cookie-input-group"));
});
$(document).on("click", "[data-apply-browser-capacity]", function () {
  applyBrowserCapacity(String($(this).data("apply-browser-capacity")));
});
$(document).on("input change", "[data-proxy-builder] [data-proxy-field]", function () {
  applyProxyBuilder(String($(this).closest("[data-proxy-builder]").data("proxy-builder")));
  toggleGoogleAuthProxyReset();
});
$(document).on("input", "[data-proxy-url]", function () {
  setProxyBuilderFromUrl(String($(this).data("proxy-url")), $(this).val());
  toggleGoogleAuthProxyReset();
});

// Proxy reset link alanı yalnızca çerez üretim proxy'si bir buymobileproxy provider'ı ise gösterilir.
function toggleGoogleAuthProxyReset() {
  const proxy = String($("#googleAuthProxyUrl").val() || "").toLowerCase();
  $("#googleAuthProxyResetWrap").toggleClass("d-none", !proxy.includes("buymobileproxy"));
}
$(document).on("input", "#googleAuthProxyUrl", toggleGoogleAuthProxyReset);
$(document).on("change", "[data-cookie-file]", function () {
  const files = Array.from(this.files || []);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const label = files.length
    ? `${files.length} dosya · ${Math.ceil(totalSize / 1024)} KB`
    : "";
  $(this).siblings("[data-cookie-file-name]").text(label);
});

function setStreamState(online) {
  $("#taskLiveState, #logLiveState, #errorLiveState, #cookieLiveState, #googleAuthLiveState, #gmailCreatorLiveState")
    .toggleClass("is-offline", !online)
    .text(online ? "live" : "reconnecting");
}

const events = new EventSource("/api/events");
events.addEventListener("connected", () => setStreamState(true));
events.addEventListener("open", () => setStreamState(true));
events.addEventListener("heartbeat", () => setStreamState(true));
events.addEventListener("error", () => setStreamState(false));
events.addEventListener("task.updated", scheduleLoadTasks);
events.addEventListener("cookie.updated", loadCookies);
events.addEventListener("googleAuth.updated", loadGoogleAuthAccounts);
events.addEventListener("gmailCreator.updated", loadGmailCreatorJobs);
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
function syncTaskEditModalBodyHeight() {
  const modal = document.getElementById("taskEditModal");
  const body = modal && modal.querySelector(".modal-body");
  const header = modal && modal.querySelector(".modal-header");
  const footer = modal && modal.querySelector(".modal-footer");
  if (!modal || !body || !header || !footer) return;

  const margin = 24;
  const available = Math.max(window.innerHeight - header.offsetHeight - footer.offsetHeight - margin, 220);
  body.style.maxHeight = `${available}px`;
  body.style.overflowY = "auto";
}
$("#taskEditModal").on("shown.bs.modal", () => {
  const modalBody = document.querySelector("#taskEditModal .modal-body");
  if (modalBody) {
    modalBody.scrollTop = 0;
  }
  syncTaskEditModalBodyHeight();
});
$("#taskEditModal").on("hidden.bs.modal", () => {
  const modalBody = document.querySelector("#taskEditModal .modal-body");
  if (modalBody) {
    modalBody.style.maxHeight = "";
  }
});
window.addEventListener("resize", () => {
  if (document.body.classList.contains("modal-open") && document.getElementById("taskEditModal")?.classList.contains("show")) {
    syncTaskEditModalBodyHeight();
  }
});
syncCookieSource("create");
syncCookieSource("edit");
syncProxyPreview("create");
syncProxyPreview("edit");
toggleGoogleAuthProxyReset();
toggleGmailCreatorProxyReset();
sanitizeOptionalFields();
checkHealth();
loadBrowserCapacity();
loadTasks();
loadCookies();
loadGoogleAuthAccounts();
loadGmailCreatorJobs();
loadLogs();
loadErrors();
