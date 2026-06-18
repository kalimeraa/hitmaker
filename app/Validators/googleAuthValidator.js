const { HttpError } = require("../Utils/httpError");
const JSZip = require("jszip");

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);
const PROXY_FORMAT_MESSAGE = "Proxy must be http://host:port, https://host:port, socks4://host:port, socks5://host:port or socks5://user:pass@host:port";

function normalizeOptionalText(value) {
  const text = String(value || "").trim();
  return ["null", "undefined"].includes(text.toLowerCase()) ? "" : text;
}

function normalizeEmail(value) {
  return normalizeOptionalText(value).toLowerCase();
}

function normalizeStatus(value) {
  const status = normalizeOptionalText(value || "active").toLowerCase();
  if (!["active", "disabled"].includes(status)) {
    throw new HttpError(400, "Account status must be active or disabled");
  }
  return status;
}

function normalizeProxyUrl(value) {
  const proxyUrl = normalizeOptionalText(value);
  if (!proxyUrl) return "";

  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch (error) {
    throw new HttpError(400, PROXY_FORMAT_MESSAGE);
  }
  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    throw new HttpError(400, PROXY_FORMAT_MESSAGE);
  }
  if (!parsed.hostname || !parsed.port) {
    throw new HttpError(400, "Proxy must include host and port");
  }
  if (parsed.protocol === "socks:") {
    parsed.protocol = "socks5:";
    return parsed.href.replace(/\/$/, "");
  }
  return proxyUrl;
}

function detectDelimiter(line) {
  const commaCount = (line.match(/,/g) || []).length;
  const tabCount = (line.match(/\t/g) || []).length;
  const semicolonCount = (line.match(/;/g) || []).length;

  if (tabCount >= commaCount && tabCount >= semicolonCount) return "\t";
  if (semicolonCount > commaCount) return ";";
  return ",";
}

function parseDelimitedRows(content) {
  const raw = normalizeOptionalText(content);
  if (!raw) return [];

  const delimiter = detectDelimiter(raw.split(/\r?\n/).find(Boolean) || "");
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const nextChar = raw[index + 1];

    if (char === '"' && quoted && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function parseXlsxRows(base64Content) {
  const raw = normalizeOptionalText(base64Content);
  if (!raw) return [];

  try {
    const zip = await JSZip.loadAsync(Buffer.from(raw, "base64"));
    const workbookXml = await zip.file("xl/workbook.xml").async("string");
    const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    const sheetRelId = (workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
    const targetMatch = sheetRelId
      ? relsXml.match(new RegExp(`<Relationship[^>]+Id="${sheetRelId}"[^>]+Target="([^"]+)"`))
      : null;
    const sheetPath = targetMatch
      ? `xl/${targetMatch[1].replace(/^\/?xl\//, "")}`
      : "xl/worksheets/sheet1.xml";
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) return [];

    const sharedStrings = await parseSharedStrings(zip);
    const sheetXml = await sheetFile.async("string");
    return parseWorksheetRows(sheetXml, sharedStrings);
  } catch (error) {
    throw new HttpError(400, `XLSX okunamadı: ${error.message}`);
  }
}

async function parseSharedStrings(zip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];

  const xml = await file.async("string");
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => (
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join("")
  ));
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function columnIndexFromCellRef(cellRef) {
  const letters = String(cellRef || "").match(/^[A-Z]+/i);
  if (!letters) return 0;

  return letters[0].toUpperCase().split("").reduce((total, letter) => (
    total * 26 + letter.charCodeAt(0) - 64
  ), 0) - 1;
}

function cellValue(cellXml, sharedStrings) {
  const type = (cellXml.match(/\bt="([^"]+)"/) || [])[1];
  if (type === "inlineStr") {
    return decodeXml([...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
  }

  const rawValue = decodeXml((cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1] || "");
  if (type === "s") {
    return sharedStrings[Number(rawValue)] || "";
  }
  return rawValue;
}

function parseWorksheetRows(sheetXml, sharedStrings) {
  return [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
    .map((rowMatch) => {
      const row = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const cellRef = (cellMatch[1].match(/\br="([^"]+)"/) || [])[1];
        row[columnIndexFromCellRef(cellRef)] = normalizeOptionalText(cellValue(cellMatch[0], sharedStrings));
      }
      return row.map((cell) => cell || "");
    })
    .filter((row) => row.some(Boolean));
}

async function parseImportRows(body) {
  const fileName = normalizeOptionalText(body.fileName).toLowerCase();
  const contentType = normalizeOptionalText(body.contentType).toLowerCase();
  const isXlsx = fileName.endsWith(".xlsx")
    || fileName.endsWith(".xls")
    || contentType.includes("spreadsheet")
    || contentType.includes("excel");

  return isXlsx ? parseXlsxRows(body.content) : parseDelimitedRows(body.content);
}

function normalizeHeader(value) {
  return normalizeOptionalText(value)
    .toLowerCase()
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9]+/g, "");
}

function findColumn(headers, names) {
  return headers.findIndex((header) => names.includes(normalizeHeader(header)));
}

function validateAccountPayload(body, { partial = false } = {}) {
  const payload = {};
  const email = normalizeEmail(body.email);
  const password = normalizeOptionalText(body.password);

  if (!partial || email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, "Valid Google email is required");
    }
    payload.email = email;
  }

  if (!partial || password) {
    if (password.length < 6) {
      throw new HttpError(400, "Google account password must be at least 6 characters");
    }
    payload.password = password;
  }

  ["recoveryEmail", "recoveryPassword", "phone", "twoFaSecret", "notes"].forEach((field) => {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = normalizeOptionalText(body[field]).slice(0, field === "notes" ? 500 : 240);
    }
  });

  if (!partial || Object.prototype.hasOwnProperty.call(body, "proxyUrl")) {
    payload.proxyUrl = normalizeProxyUrl(body.proxyUrl);
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "status")) {
    payload.status = normalizeStatus(body.status);
  }

  if (!Object.keys(payload).length) {
    throw new HttpError(400, "No account fields to update");
  }

  return payload;
}

function validateCookieGenerationPayload(body = {}) {
  const headless = typeof body.headless === "undefined" ? true : Boolean(body.headless);
  const deviceMode = normalizeOptionalText(body.deviceMode || "desktop").toLowerCase();
  const proxyUrl = normalizeProxyUrl(body.proxyUrl);
  if (!["desktop", "mobile"].includes(deviceMode)) {
    throw new HttpError(400, "Device mode must be desktop or mobile");
  }

  return {
    headless,
    deviceMode,
    proxyUrl,
    captchaApiKey: normalizeOptionalText(body.captchaApiKey).slice(0, 120),
    proxyProvider: normalizeOptionalText(body.proxyProvider).toLowerCase().slice(0, 60),
    proxyResetUrl: normalizeOptionalText(body.proxyResetUrl).slice(0, 500),
    maxAttempts: Math.min(5, Math.max(1, Number(body.maxAttempts) || 3)),
    notes: normalizeOptionalText(body.notes).slice(0, 500)
  };
}

async function validateAccountImportPayload(body = {}) {
  const rows = await parseImportRows(body);
  if (rows.length < 2) {
    throw new HttpError(400, "CSV/TSV dosyasında header ve en az bir hesap satırı olmalı");
  }

  const headers = rows[0];
  const emailIndex = findColumn(headers, ["gmail", "email", "googleemail", "mail"]);
  const passwordIndex = findColumn(headers, ["sifre", "password", "pass"]);
  const twoFaIndex = findColumn(headers, ["2fa", "twofa", "totp", "secret", "twofasecret"]);
  const proxyIndex = findColumn(headers, ["proxy", "proxyurl"]);
  const recoveryEmailIndex = findColumn(headers, ["recoveryemail", "kurtarmaemail", "recoverymail"]);
  const recoveryPasswordIndex = findColumn(headers, ["recoverysifre", "recoverypassword"]);
  const phoneIndex = findColumn(headers, ["telefon", "phone"]);
  const noteIndex = findColumn(headers, ["not", "notes", "note"]);

  if (emailIndex === -1 || passwordIndex === -1 || twoFaIndex === -1) {
    throw new HttpError(400, "CSV header içinde gmail/email, sifre/şifre ve 2fa kolonları olmalı");
  }

  const fallbackProxyUrl = normalizeProxyUrl(body.proxyUrl);

  const accounts = rows.slice(1).map((row) => {
    const rowProxy = proxyIndex >= 0 ? normalizeProxyUrl(row[proxyIndex]) : "";
    const email = normalizeEmail(row[emailIndex]);
    const account = {
      email,
      password: normalizeOptionalText(row[passwordIndex]),
      twoFaSecret: normalizeOptionalText(row[twoFaIndex]),
      proxyUrl: rowProxy || fallbackProxyUrl,
      status: "active",
      notes: normalizeOptionalText(noteIndex >= 0 ? row[noteIndex] : "") || "local spreadsheet import"
    };

    if (recoveryEmailIndex >= 0) account.recoveryEmail = normalizeEmail(row[recoveryEmailIndex]);
    if (recoveryPasswordIndex >= 0) account.recoveryPassword = normalizeOptionalText(row[recoveryPasswordIndex]);
    if (phoneIndex >= 0) account.phone = normalizeOptionalText(row[phoneIndex]);

    return validateAccountPayload(account);
  }).filter((account) => account.email);

  if (!accounts.length) {
    throw new HttpError(400, "Import edilecek geçerli hesap bulunamadı");
  }

  return { accounts: accounts.slice(0, 500), autoGenerate: Boolean(body.autoGenerate) };
}

module.exports = {
  validateAccountPayload,
  validateCookieGenerationPayload,
  validateAccountImportPayload
};
