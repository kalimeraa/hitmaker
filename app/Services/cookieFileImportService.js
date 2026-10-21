const { validateCookieFilePayload, MAX_COOKIE_FILES, MAX_TOTAL_BYTES } = require("../Validators/cookieFileValidator");
const { parseCookieSets } = require("../Validators/taskValidator");
const { readCookieArchive } = require("../Utils/cookieArchive");
const { HttpError } = require("../Utils/httpError");

const MAX_COOKIE_FILE_BYTES = 1024 * 1024;

async function parseCookieFiles(payload) {
  const { files, targetAddress } = validateCookieFilePayload(payload);
  const cookieSets = [];
  let expandedBytes = 0;

  for (const file of files) {
    const entries = /\.zip$/i.test(file.name)
      ? readCookieArchive(file.data, { maxFileBytes: MAX_COOKIE_FILE_BYTES, maxFiles: MAX_COOKIE_FILES, maxEntries: 500 })
      : [file];
    for await (const entry of entries) {
      expandedBytes += entry.data.length;
      if (entry.data.length > MAX_COOKIE_FILE_BYTES || expandedBytes > MAX_TOTAL_BYTES || cookieSets.length >= MAX_COOKIE_FILES) {
        throw new HttpError(400, "Cookie sınırı aşıldı: dosya başına 1 MB, toplam 10 MB ve en fazla 50 cookie seti.");
      }
      let parsed;
      try {
        parsed = parseCookieSets([{ name: entry.name, content: entry.data.toString("utf8").replace(/^\uFEFF/, "") }], targetAddress);
      } catch (error) {
        throw new HttpError(400, `Cookie dosyası geçersiz: ${entry.name}`);
      }
      if (!parsed.length) throw new HttpError(400, `Cookie dosyası boş: ${entry.name}`);
      cookieSets.push(parsed[0]);
    }
  }
  return { targetAddress, cookieSets };
}

module.exports = { parseCookieFiles };
