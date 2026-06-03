function statusBadge(status) {
  return `<span class="status-pill status-${status}">${status}</span>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTask(task) {
  const percent = task.count ? Math.round((task.progress / task.count) * 100) : 0;
  const runs = (task.runs || []).map((run) => `
    <div class="run-row">
      <span>${escapeHtml(run.keyword)}</span>
      <span>${statusBadge(run.status)}</span>
      <span>${run.matchedUrl ? `<a href="${escapeHtml(run.matchedUrl)}" target="_blank" rel="noreferrer">${escapeHtml(run.matchedUrl)}</a>` : escapeHtml(run.error || (run.scheduledAt ? `scheduled ${new Date(run.scheduledAt).toLocaleString()}` : "-"))}</span>
    </div>
  `).join("");

  return `
    <article class="task-card">
      <div class="d-flex flex-wrap justify-content-between gap-2">
        <div>
          <div class="fw-semibold">${escapeHtml(task.targetAddress)}</div>
          <div class="task-meta">${escapeHtml(task.keywords.join(", "))}</div>
        </div>
        <div>${statusBadge(task.status)}</div>
      </div>
      <div class="task-meta mt-2">
        ${task.count} click · ${Number(task.durationHours || 0)} saat · ${task.headless ? "headless" : "visible"} · ${task.proxyUrl ? "proxy" : "direct"} · ${(task.cookies || []).length} cookie · ${new Date(task.createdAt).toLocaleString()}
      </div>
      <div class="progress mt-3" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-bar" style="width:${percent}%">${percent}%</div>
      </div>
      ${runs ? `<div class="run-list">${runs}</div>` : ""}
    </article>
  `;
}

async function loadTasks() {
  const tasks = await $.getJSON("/api/tasks");
  $("#tasks").html(tasks.length ? tasks.map(renderTask).join("") : '<div class="text-secondary">Henüz task yok.</div>');
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
        durationHours: Number($("#durationHours").val()),
        headless: $("#headless").is(":checked"),
        proxyUrl: $("#proxyUrl").val(),
        cookies: $("#cookies").val()
      })
    });
    await loadTasks();
  } catch (xhr) {
    alert((xhr.responseJSON && xhr.responseJSON.error) || "Task oluşturulamadı");
  } finally {
    $button.prop("disabled", false).text("Task aç");
  }
});

$("#refreshBtn").on("click", loadTasks);
$("#refreshLogsBtn").on("click", loadLogs);
$("#refreshErrorsBtn").on("click", loadErrors);
$("#logLevel").on("change", loadLogs);

const events = new EventSource("/api/events");
events.addEventListener("completed", loadTasks);
events.addEventListener("failed", loadTasks);
events.addEventListener("progress", loadTasks);

checkHealth();
loadTasks();
loadLogs();
loadErrors();
setInterval(loadTasks, 5000);
setInterval(loadLogs, 5000);
setInterval(loadErrors, 5000);
