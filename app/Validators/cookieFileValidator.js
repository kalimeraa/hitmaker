const { normalizeHost } = require("../Utils/domain");
const { HttpError } = require("../Utils/httpError");

const MAX_COOKIE_FILES = 50;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

function validateCookieFilePayload(body) {
  const files = body && body.files;
  if (!Array.isArray(files) || !files.length || files.length > MAX_COOKIE_FILES) {
    throw new HttpError(400, "1–50 cookie dosyası veya ZIP arşivi seçin.");
  }

  const targetAddress = String(body.targetAddress || "google.com").trim();
  try {
    normalizeHost(targetAddress);
  } catch (error) {
    throw new HttpError(400, "Cookie hedef domaini geçersiz.");
  }

  let totalBytes = 0;
  return {
    targetAddress,
    files: files.map((file) => {
      const name = String(file && file.name || "").replace(/\\/g, "/").split("/").pop();
      const base64 = file && file.base64;
      if (!/\.(?:txt|json|cookies|zip)$/i.test(name)) {
        throw new HttpError(400, "Desteklenen cookie dosyaları: TXT, JSON, COOKIES ve ZIP.");
      }
      if (typeof base64 !== "string" || !base64.length || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
        throw new HttpError(400, "Cookie dosyası boş veya okunamadı.");
      }
      totalBytes += Buffer.byteLength(base64, "base64");
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new HttpError(400, "Seçilen cookie dosyalarının toplamı 10 MB sınırını aşıyor.");
      }
      return { name, data: Buffer.from(base64, "base64") };
    })
  };
}

module.exports = { validateCookieFilePayload, MAX_COOKIE_FILES, MAX_TOTAL_BYTES };
