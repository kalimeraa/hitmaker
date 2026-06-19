const fs = require("fs/promises");
const path = require("path");
const googleAuthAccountRepository = require("../Repositories/googleAuthAccountRepository");
const cookiePoolRepository = require("../Repositories/cookiePoolRepository");
const realtimeEventService = require("./realtimeEventService");
const { logger } = require("./logService");
const { generateGoogleAuthCookies } = require("../Automation/googleAuthLogin");
const { detectProxyProvider } = require("./proxyProviderService");

// Bir login başarısızlığını "retry" (taze IP ile tekrar dene) veya "terminal" (denemeyi bırak) olarak
// sınıflandırır. Captcha/güvensiz-tarayıcı IP itibarının semptomu → taze IP'de kaybolabilir.
// Telefon doğrulama hesabın yandığını, 2FA hatası secret/hesap sorununu gösterir → IP rotasyonu çözmez.
function classifyLoginFailure(result = {}) {
  const reason = result.failureReason || "";
  const error = String(result.error || "");
  if (reason === "phone_verification" || reason === "2fa_challenge") return "terminal";
  if (reason === "recaptcha_challenge" || reason === "unsafe_browser") return "retry";
  if (/TUNNEL_CONNECTION_FAILED|ECONNRESET|ETIMEDOUT|net::ERR|timeout|Target closed/i.test(error)) return "retry";
  return "terminal";
}
const { validateAccountPayload, validateCookieGenerationPayload, validateAccountImportPayload } = require("../Validators/googleAuthValidator");
const { HttpError } = require("../Utils/httpError");

const COOKIE_STORAGE_ROOT = path.resolve(process.cwd(), "storage", "google-auth-cookies");
const COOKIE_BUNDLE_ROOT = path.join(COOKIE_STORAGE_ROOT, "_bundles");

function safeFilePart(value) {
  return String(value || "google-account")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "google-account";
}

function proxyHost(proxyUrl) {
  if (!proxyUrl) return "";
  try {
    return new URL(proxyUrl).host;
  } catch (error) {
    return "";
  }
}

function cookieFileNameFor(account, generatedAt = new Date()) {
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${safeFilePart(account.email)}.json`;
}

function assertInsideCookieStorage(filePath) {
  const resolved = path.resolve(filePath || "");
  if (!resolved.startsWith(`${COOKIE_STORAGE_ROOT}${path.sep}`)) {
    throw new HttpError(400, "Cookie file path is outside storage");
  }
  return resolved;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function createZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime();

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name.replaceAll("\\", "/"));
    const data = file.data;
    const checksum = crc32(data);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer
    ]);

    localParts.push(localHeader, data);

    centralParts.push(Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      nameBuffer
    ]));

    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0)
  ]);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

class GoogleAuthService {
  constructor(accountRepository = googleAuthAccountRepository, cookieRepository = cookiePoolRepository, authAutomation = generateGoogleAuthCookies) {
    this.accountRepository = accountRepository;
    this.cookieRepository = cookieRepository;
    this.authAutomation = authAutomation;
  }

  async listAccounts() {
    const accounts = await this.accountRepository.findRecent();
    return accounts.map((account) => account.toJSON());
  }

  async createAccount(payload) {
    const validated = validateAccountPayload(payload);
    const account = await this.accountRepository.create(validated);
    logger.info("google_auth_account_created", { accountId: String(account._id), email: account.email });
    await realtimeEventService.publish("googleAuth.updated", { action: "created", accountId: String(account._id) });
    return account.toJSON();
  }

  async updateAccount(id, payload) {
    const validated = validateAccountPayload(payload, { partial: true });
    const account = await this.accountRepository.update(id, validated);
    if (!account) return null;
    logger.info("google_auth_account_updated", { accountId: String(account._id), email: account.email });
    await realtimeEventService.publish("googleAuth.updated", { action: "updated", accountId: String(account._id) });
    return account.toJSON();
  }

  async importAccounts(payload) {
    const validated = await validateAccountImportPayload(payload);
    const accounts = [];

    for (const accountPayload of validated.accounts) {
      const account = await this.accountRepository.upsertByEmail(accountPayload.email, accountPayload);
      accounts.push(account.toJSON());
    }

    logger.info("google_auth_accounts_imported", {
      importedCount: accounts.length,
      autoGenerate: validated.autoGenerate
    });
    await realtimeEventService.publish("googleAuth.updated", { action: "imported", count: accounts.length });

    return {
      accounts,
      importedCount: accounts.length,
      autoGenerate: validated.autoGenerate
    };
  }

  async deleteAccount(id) {
    const account = await this.accountRepository.deleteById(id);
    if (!account) return null;
    logger.info("google_auth_account_deleted", { accountId: String(account._id), email: account.email });
    await realtimeEventService.publish("googleAuth.updated", { action: "deleted", accountId: String(account._id) });
    return account.toJSON();
  }

  async deleteAllAccounts() {
    const result = await this.accountRepository.deleteAll();
    const deletedCount = Number(result.deletedCount || 0);
    logger.info("google_auth_accounts_deleted", { deletedCount });
    await realtimeEventService.publish("googleAuth.updated", { action: "deleted_all", deletedCount });
    return { deletedCount };
  }

  async writeCookieFile(account, cookie, cookies, loginUrl = "") {
    const generatedAt = new Date();
    const accountDir = path.join(COOKIE_STORAGE_ROOT, safeFilePart(account.email));
    const fileName = cookieFileNameFor(account, generatedAt);
    const filePath = path.join(accountDir, fileName);

    await fs.mkdir(accountDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
      accountId: String(account._id),
      email: account.email,
      cookiePoolId: String(cookie._id || cookie.id || ""),
      generatedAt: generatedAt.toISOString(),
      loginUrl,
      cookies
    }, null, 2), { mode: 0o600 });

    return { filePath, fileName };
  }

  async getCookieFile(id) {
    const account = await this.accountRepository.findById(id);
    if (!account) {
      throw new HttpError(404, "Google auth account not found");
    }

    if (account.lastCookieFilePath) {
      const filePath = assertInsideCookieStorage(account.lastCookieFilePath);
      try {
        await fs.access(filePath);
        return {
          filePath,
          fileName: account.lastCookieFileName || path.basename(filePath)
        };
      } catch (error) {
        logger.warn("google_auth_cookie_file_missing", {
          accountId: String(account._id),
          email: account.email,
          filePath
        });
      }
    }

    if (!account.lastCookiePoolId) {
      throw new HttpError(404, "Generated cookie file not found");
    }

    const cookie = await this.cookieRepository.findById(account.lastCookiePoolId);
    if (!cookie || !cookie.cookies || !cookie.cookies.length) {
      throw new HttpError(404, "Generated cookie file not found");
    }

    const cookieFile = await this.writeCookieFile(account, cookie, cookie.cookies, account.lastLoginUrl || "");
    await this.accountRepository.markCookieFile(id, {
      cookieFilePath: cookieFile.filePath,
      cookieFileName: cookieFile.fileName
    });

    logger.info("google_auth_cookie_file_backfilled", {
      accountId: String(account._id),
      email: account.email,
      cookiePoolId: String(cookie._id),
      cookieFileName: cookieFile.fileName
    });

    return cookieFile;
  }

  async getCookieBundleFile() {
    const accounts = await this.accountRepository.findRecent(500);
    const files = [];

    for (const account of accounts) {
      if (!account.lastCookiePoolId && !account.lastCookieFilePath) continue;

      try {
        const cookieFile = await this.getCookieFile(account._id);
        const filePath = assertInsideCookieStorage(cookieFile.filePath);
        const data = await fs.readFile(filePath);
        const accountFolder = safeFilePart(account.email);
        files.push({
          name: `${accountFolder}/${cookieFile.fileName}`,
          data
        });
      } catch (error) {
        logger.warn("google_auth_cookie_bundle_item_skipped", {
          accountId: String(account._id),
          email: account.email,
          error: error.message
        });
      }
    }

    if (!files.length) {
      throw new HttpError(404, "Downloaded cookie file not found");
    }

    await fs.mkdir(COOKIE_BUNDLE_ROOT, { recursive: true });
    const fileName = `google-auth-cookies-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    const filePath = path.join(COOKIE_BUNDLE_ROOT, fileName);
    await fs.writeFile(filePath, createZipBuffer(files), { mode: 0o600 });

    logger.info("google_auth_cookie_bundle_created", {
      fileName,
      fileCount: files.length
    });

    return { filePath, fileName, fileCount: files.length };
  }

  async generateCookies(id, payload) {
    const options = validateCookieGenerationPayload(payload);
    const account = await this.accountRepository.findById(id);
    if (!account) {
      throw new HttpError(404, "Google auth account not found");
    }
    if (account.status !== "active") {
      throw new HttpError(400, "Google auth account is disabled");
    }

    logger.info("google_auth_cookie_generation_started", {
      accountId: String(account._id),
      email: account.email,
      headless: options.headless,
      deviceMode: options.deviceMode,
      hasProxy: Boolean(options.proxyUrl)
    });

    const effectiveProxyUrl = options.proxyUrl || account.proxyUrl || "";
    const proxyProvider = detectProxyProvider(effectiveProxyUrl);
    const canRotate = Boolean(proxyProvider && proxyProvider.manualReset && options.proxyResetUrl);
    const onEvent = async (event, meta = {}) => {
      logger.info(event, { accountId: String(account._id), email: account.email, ...meta });
    };

    // IP-rotasyon-retry algoritması: captcha/güvensiz-tarayıcı bir IP'nin yanmasının semptomu —
    // 2captcha signin token'ını Google reddediyor, o yüzden aynı IP'de ısrar etmek anlamsız. Her
    // denemede TAZE IP al, baştan dene. Telefon doğrulama (yanmış) veya 2FA hatası terminal: retry yok.
    const maxAttempts = canRotate ? options.maxAttempts : 1;
    let result = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await onEvent("google_auth_attempt_started", { attempt, maxAttempts, canRotate });

      // Her denemeden önce taze mobil IP (rotasyon açıksa).
      if (canRotate) {
        await onEvent("google_auth_proxy_reset_started", { provider: proxyProvider.name, attempt });
        const reset = await proxyProvider.resetIp({ resetUrl: options.proxyResetUrl });
        await onEvent(reset.success ? "google_auth_proxy_reset_completed" : "google_auth_proxy_reset_failed", {
          provider: proxyProvider.name, attempt, status: reset.status, error: reset.error, response: reset.response
        });
      }

      result = await this.authAutomation({
        email: account.email,
        password: account.password,
        twoFaSecret: account.twoFaSecret,
        headless: options.headless,
        deviceMode: options.deviceMode,
        proxyUrl: effectiveProxyUrl,
        captchaApiKey: options.captchaApiKey || "",
        profileKey: String(account._id),
        onEvent
      });

      if (result.success) break;

      const decision = classifyLoginFailure(result);
      await onEvent("google_auth_attempt_failed", {
        attempt, maxAttempts, failureReason: result.failureReason || "", error: result.error || "", decision
      });
      // terminal (yanmış / 2FA) → retry etme; retry → sıradaki taze IP; son denemeyse çık.
      if (decision === "terminal" || attempt >= maxAttempts) break;
    }

    if (!result || !result.success) {
      const failure = result || { error: "google_auth_failed" };
      await this.accountRepository.markLoginFailed(id, failure.error || "Google auth failed", failure.url || "", failure.failureReason || "");
      await realtimeEventService.publish("googleAuth.updated", { action: "failed", accountId: String(account._id), challenge: failure.failureReason || "" });
      throw new HttpError(400, failure.error || "Google auth failed");
    }

    const cookie = await this.cookieRepository.create({
      name: `google-auth:${account.email}:${new Date().toISOString()}`,
      notes: options.notes || `Google auth cookies generated from ${account.email}`,
      sourceType: "google_auth",
      sourceAccountId: String(account._id),
      profileKey: String(account._id),
      sourceProxyHost: proxyHost(effectiveProxyUrl),
      cookies: result.cookies,
      status: "active"
    });
    const cookieFile = await this.writeCookieFile(account, cookie, result.cookies, result.url);

    await this.accountRepository.markCookieGenerated(id, {
      cookiePoolId: String(cookie._id),
      cookieFilePath: cookieFile.filePath,
      cookieFileName: cookieFile.fileName,
      loginUrl: result.url
    });

    logger.info("google_auth_cookie_generation_completed", {
      accountId: String(account._id),
      email: account.email,
      cookiePoolId: String(cookie._id),
      cookieFileName: cookieFile.fileName,
      cookieCount: result.cookies.length
    });
    await realtimeEventService.publish("googleAuth.updated", { action: "cookies_generated", accountId: String(account._id), cookiePoolId: String(cookie._id) });
    await realtimeEventService.publish("cookie.updated", { action: "google_auth_imported", cookieId: String(cookie._id) });

    return {
      account: (await this.accountRepository.findById(id)).toJSON(),
      cookie: cookie.toObject ? cookie.toObject() : cookie,
      cookieFile,
      cookieCount: result.cookies.length,
      url: result.url
    };
  }
}

module.exports = new GoogleAuthService();
