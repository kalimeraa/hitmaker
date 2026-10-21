const JSZip = require("jszip");
const { HttpError } = require("./httpError");

function readEntry(entry, maxFileBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let stopped = false;
    const stream = entry.internalStream("nodebuffer");
    stream.on("data", (chunk) => {
      if (stopped) return;
      bytes += chunk.length;
      if (bytes > maxFileBytes) {
        stopped = true;
        chunks.length = 0;
        stream.pause();
        reject(new HttpError(400, "ZIP içindeki bir cookie dosyası açıldığında 1 MB sınırını aşıyor."));
        return;
      }
      chunks.push(chunk);
    }).on("error", reject).on("end", () => {
      if (!stopped) resolve(Buffer.concat(chunks, bytes));
    }).resume();
  });
}

async function* readCookieArchive(data, { maxFileBytes, maxFiles, maxEntries }) {
  try {
    const archive = await JSZip.loadAsync(data);
    const entries = Object.values(archive.files);
    if (entries.length > maxEntries) {
      throw new HttpError(400, "ZIP arşivi en fazla 500 kayıt içerebilir.");
    }
    const cookieFiles = entries.filter((entry) => !entry.dir
      && !entry.name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX")
      && /\.(?:txt|json|cookies)$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!cookieFiles.length) {
      throw new HttpError(400, "ZIP içinde TXT, JSON veya COOKIES cookie dosyası bulunamadı.");
    }
    if (cookieFiles.length > maxFiles) {
      throw new HttpError(400, "ZIP arşivinde en fazla 50 cookie dosyası bulunabilir.");
    }
    for (const entry of cookieFiles) {
      yield { name: entry.name, data: await readEntry(entry, maxFileBytes) };
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "ZIP arşivi bozuk, şifreli veya okunamıyor.");
  }
}

module.exports = { readCookieArchive };
