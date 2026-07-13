const fs = require("fs/promises");
const path = require("path");
const JSZip = require("jszip");
const { logger } = require("./logService");
const { mirrorSite, MOCK_SITES_ROOT, sanitizeDocumentHtml, injectPopupDismisser } = require("../Automation/siteMirror");
const { headlessDefault } = require("../../config/app");

// Slug'ı MOCK_SITES_ROOT içine sabitle — path traversal (../) engellenir.
function resolveSiteDir(slug) {
  const safe = String(slug || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe || safe === "." || safe === "..") return null;
  const dir = path.join(MOCK_SITES_ROOT, safe);
  if (dir !== MOCK_SITES_ROOT && !dir.startsWith(MOCK_SITES_ROOT + path.sep)) return null;
  return dir;
}

async function readManifest(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "mirror-manifest.json"), "utf8"));
  } catch (error) {
    return null;
  }
}

// Serve girişini bul: önce manifest.entry, yoksa index.html içeren ilk alt klasör.
async function getEntry(slug) {
  const dir = resolveSiteDir(slug);
  if (!dir) return null;

  const manifest = await readManifest(dir);
  if (manifest && manifest.entry) return manifest.entry;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await fs.access(path.join(dir, entry.name, "index.html"));
        return `${entry.name}/index.html`;
      } catch (error) {
        // sıradaki klasöre bak
      }
    }
  } catch (error) {
    return null;
  }
  return null;
}

async function listSites() {
  let entries;
  try {
    entries = await fs.readdir(MOCK_SITES_ROOT, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  const sites = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const manifest = await readManifest(path.join(MOCK_SITES_ROOT, slug));
    sites.push({
      slug,
      host: (manifest && manifest.host) || slug,
      entry: (manifest && manifest.entry) || null,
      documents: manifest && manifest.counts ? manifest.counts.documents : null,
      files: manifest && manifest.counts ? manifest.counts.files : null,
      bytes: manifest ? manifest.bytes : null,
      generatedAt: (manifest && manifest.generatedAt) || null,
      serveUrl: `/api/site-mirror/serve/${slug}/`,
      downloadUrl: `/api/site-mirror/${slug}/download`
    });
  }

  sites.sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
  return sites;
}

async function addDirToZip(zip, dir, baseDir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await addDirToZip(zip, fullPath, baseDir);
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, fullPath).split(path.sep).join("/");
      zip.file(rel, await fs.readFile(fullPath));
    }
  }
}

// Mirror klasörünün tamamını zip buffer'ı olarak döndürür (download için). Yoksa null.
async function zipSite(slug) {
  const dir = resolveSiteDir(slug);
  if (!dir) return null;
  try {
    await fs.access(dir);
  } catch (error) {
    return null;
  }

  const zip = new JSZip();
  await addDirToZip(zip, dir, dir);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// İndirilmiş bir mirror'ı YENİDEN ÇEKMEDEN düzeltir: diskteki HTML dosyalarına tracking/cloudflare
// temizliği + popup-kapatıcı script'i (yeniden) uygular. Link rewrite'a dokunmaz (zaten yapılmıştı).
async function reprocessSite(slug) {
  const dir = resolveSiteDir(slug);
  if (!dir) return null;
  try {
    await fs.access(dir);
  } catch (error) {
    return null;
  }

  const htmlFiles = [];
  const walk = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".html")) htmlFiles.push(full);
    }
  };
  await walk(dir);

  let changed = 0;
  for (const file of htmlFiles) {
    const before = await fs.readFile(file, "utf8");
    // Sadece gerçek doküman HTML'lerine uygula (gövdesi olanlar).
    if (!/<\/body>|<html[\s>]/i.test(before)) continue;
    const after = injectPopupDismisser(sanitizeDocumentHtml(before));
    if (after !== before) {
      await fs.writeFile(file, after);
      changed += 1;
    }
  }

  logger.info("site_mirror_reprocessed", { slug, files: htmlFiles.length, changed });
  return { slug, htmlFiles: htmlFiles.length, changed };
}

// Bir mirror klasörünü diskten tamamen kaldırır. Slug MOCK_SITES_ROOT'a sabitlenir (traversal engelli).
async function deleteSite(slug) {
  const dir = resolveSiteDir(slug);
  if (!dir || dir === MOCK_SITES_ROOT) return false;
  try {
    await fs.access(dir);
  } catch (error) {
    return false;
  }
  await fs.rm(dir, { recursive: true, force: true });
  logger.info("site_mirror_deleted", { slug });
  return true;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

// Proxy'yi loglarken kimlik bilgilerini maskele.
function maskProxy(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const url = new URL(proxyUrl);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch (error) {
    return "invalid-proxy";
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function mirror(payload = {}) {
  const url = String(payload.url || "").trim();
  if (!url) throw badRequest("url is required");

  const proxyUrl = String(payload.proxyUrl || payload.proxy || "").trim() || undefined;
  if (proxyUrl) {
    try {
      // eslint-disable-next-line no-new
      new URL(proxyUrl);
    } catch (error) {
      throw badRequest("proxyUrl is not a valid URL");
    }
  }

  const options = {
    url,
    proxyUrl,
    maxDepth: clampInt(payload.maxDepth, 0, 5, 2),
    maxPages: clampInt(payload.maxPages, 1, 200, 25),
    deviceMode: payload.deviceMode === "mobile" ? "mobile" : "desktop",
    headless: typeof payload.headless === "boolean" ? payload.headless : headlessDefault,
    sameHostOnly: payload.sameHostOnly !== false
  };

  const onEvent = async (event, meta = {}) => {
    logger.info(event, meta);
  };

  logger.info("site_mirror_started", {
    url,
    proxyUrl: maskProxy(proxyUrl),
    maxDepth: options.maxDepth,
    maxPages: options.maxPages,
    deviceMode: options.deviceMode,
    headless: options.headless
  });

  try {
    const result = await mirrorSite({ ...options, onEvent });
    logger.info("site_mirror_completed", {
      root: result.root,
      dir: result.dir,
      pages: result.pages,
      files: result.files,
      assets: result.assets,
      bytes: result.bytes
    });
    return result;
  } catch (error) {
    logger.error("site_mirror_failed", { url, error: error.message });
    throw error;
  }
}

module.exports = { mirror, maskProxy, listSites, resolveSiteDir, getEntry, zipSite, reprocessSite, deleteSite };
