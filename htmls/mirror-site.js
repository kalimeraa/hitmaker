/*
 * Site mirror CLI — bir adres verilir, CloakBrowser açılır ve sitenin tüm asset'leri
 * mock-sites/<site-slug>/ altına indirilir. Proxy komut satırından veya env ile girilir.
 *
 * Kullanım:
 *   node htmls/mirror-site.js <url> [--proxy http://user:pass@host:port] [--depth 2] [--pages 25] [--headful] [--mobile]
 *
 * Proxy ayrıca env ile de verilebilir (repo'ya secret yazmamak için tercih edilir):
 *   MIRROR_PROXY=http://user:pass@host:port node htmls/mirror-site.js https://example.com
 */

const { mirrorSite } = require("../app/Automation/siteMirror");

function parseArgs(argv) {
  const args = { url: "", proxyUrl: process.env.MIRROR_PROXY || "", maxDepth: 2, maxPages: 25, headless: true, deviceMode: "desktop" };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--proxy") { args.proxyUrl = argv[++i] || ""; continue; }
    if (token === "--depth") { args.maxDepth = Number(argv[++i]); continue; }
    if (token === "--pages") { args.maxPages = Number(argv[++i]); continue; }
    if (token === "--headful") { args.headless = false; continue; }
    if (token === "--mobile") { args.deviceMode = "mobile"; continue; }
    if (!token.startsWith("--") && !args.url) { args.url = token; continue; }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error("Usage: node htmls/mirror-site.js <url> [--proxy <url>] [--depth N] [--pages N] [--headful] [--mobile]");
    process.exit(1);
  }

  const onEvent = async (event, meta) => {
    console.log(`[${event}]`, JSON.stringify(meta));
  };

  console.log(`Mirroring ${args.url} (depth=${args.maxDepth}, pages=${args.maxPages}, proxy=${args.proxyUrl ? "yes" : "no"})`);
  const result = await mirrorSite({ ...args, proxyUrl: args.proxyUrl || undefined, onEvent });

  console.log("\n=== DONE ===");
  console.log(`Output dir : ${result.dir}`);
  console.log(`Pages      : ${result.pages}`);
  console.log(`Files      : ${result.files} (assets: ${result.assets}, documents: ${result.documents})`);
  console.log(`Bytes      : ${result.bytes}`);
}

main().catch((error) => {
  console.error("mirror failed:", error);
  process.exit(1);
});
