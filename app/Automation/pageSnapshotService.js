const fs = require("fs/promises");
const path = require("path");

const SNAPSHOT_DIR = path.join(process.cwd(), "htmls");

function safeFilePart(value) {
  return String(value || "snapshot")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "snapshot";
}

function compactText(value, maxLength = 5000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function extractPageMetadata(page, label) {
  return page.evaluate((snapshotLabel) => {
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    const attr = (el, name) => el.getAttribute(name) || "";
    const text = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();

    const fields = Array.from(document.querySelectorAll("input, textarea, select"))
      .filter(visible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: attr(el, "type"),
        name: attr(el, "name"),
        id: attr(el, "id"),
        ariaLabel: attr(el, "aria-label"),
        autocomplete: attr(el, "autocomplete"),
        placeholder: attr(el, "placeholder"),
        value: el.type === "password" ? "" : (el.value || ""),
        maxLength: attr(el, "maxlength")
      }));

    const interactive = Array.from(document.querySelectorAll("[role='combobox'], [role='button'], [role='option'], button, a"))
      .filter(visible)
      .slice(0, 120)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: attr(el, "role"),
        id: attr(el, "id"),
        ariaLabel: attr(el, "aria-label"),
        ariaControls: attr(el, "aria-controls"),
        dataValue: attr(el, "data-value"),
        text: text(el).slice(0, 160)
      }));

    return {
      label: snapshotLabel,
      url: window.location.href,
      title: document.title,
      fields,
      interactive,
      visibleText: text(document.body).slice(0, 5000)
    };
  }, label).catch((error) => ({
    label,
    url: page.url(),
    error: error.message
  }));
}

function createPageSnapshotter({ prefix = "gmail_creator", runKey = "", onEvent = async () => {} } = {}) {
  let counter = 0;
  const safeRunKey = safeFilePart(runKey || new Date().toISOString());

  return async function snapshotPage(page, label, meta = {}) {
    if (!page || page.isClosed()) return null;

    counter += 1;
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

    const safeLabel = safeFilePart(label);
    const baseName = `${safeFilePart(prefix)}_${safeRunKey}_${String(counter).padStart(2, "0")}_${safeLabel}`;
    const htmlPath = path.join(SNAPSHOT_DIR, `${baseName}.html`);
    const jsonPath = path.join(SNAPSHOT_DIR, `${baseName}.json`);

    const [html, pageMetadata] = await Promise.all([
      page.content().catch((error) => `<!-- snapshot_error: ${error.message} -->`),
      extractPageMetadata(page, label)
    ]);

    const payload = {
      ...pageMetadata,
      ...meta,
      savedAt: new Date().toISOString(),
      htmlFile: path.basename(htmlPath),
      jsonFile: path.basename(jsonPath)
    };

    await Promise.all([
      fs.writeFile(htmlPath, html, "utf8"),
      fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    ]);

    await onEvent("gmail_creator_step_snapshot_saved", {
      label,
      url: payload.url || page.url(),
      htmlPath,
      jsonPath
    });

    return { htmlPath, jsonPath, metadata: payload };
  };
}

module.exports = {
  createPageSnapshotter,
  extractPageMetadata
};
