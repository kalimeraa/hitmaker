const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { runMirror } = require("./desktop/mirrorRuntime");
const { defaultOutputDir } = require("./desktop/pathPolicy");
const { validateUrl } = require("./desktop/pathPolicy");

const root = __dirname;
const jobs = new Map();
const port = Number(process.env.PORT || 4173);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json" };
function send(res, status, body, type = "application/json") { res.writeHead(status, { "content-type": type }); res.end(type.startsWith("application/json") ? JSON.stringify(body) : body); }
function body(req) { return new Promise((resolve, reject) => { let text = ""; req.on("data", (chunk) => { text += chunk; if (text.length > 1000000) reject(new Error("Payload too large")); }); req.on("end", () => { try { resolve(JSON.parse(text || "{}")); } catch (error) { reject(error); } }); req.on("error", reject); }); }
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "POST" && url.pathname === "/api/mirror") {
      const payload = await body(req); const host = validateUrl(payload.url).hostname; const id = `mirror_${Date.now()}`; const outputDir = payload.outputDir || defaultOutputDir(require("os").homedir() + "/Documents", host); const job = { id, status: "running", outputDir, progress: {} }; jobs.set(id, job); send(res, 202, job);
      runMirror({ ...payload, outputDir, onProgress: async (progress) => { job.progress = progress; } }).then((result) => { job.status = "completed"; job.result = { ...result, previewUrl: `/preview/${id}/${result.entry || "index.html"}` }; }).catch((error) => { job.status = "failed"; job.error = error.message; }); return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/mirror/")) { const job = jobs.get(url.pathname.split("/").pop()); if (!job) return send(res, 404, { error: "Not found" }); return send(res, 200, job); }
    if (req.method === "GET" && url.pathname.startsWith("/preview/")) { const parts = url.pathname.split("/").filter(Boolean); const job = jobs.get(parts[1]); if (!job?.result?.outputDir) return send(res, 404, { error: "Preview not ready" }); const previewFile = path.resolve(job.result.outputDir, parts.slice(2).join("/") || job.result.entry || "index.html"); if (!previewFile.startsWith(path.resolve(job.result.outputDir))) return send(res, 403, { error: "Forbidden" }); const data = await fs.readFile(previewFile); return send(res, 200, data, mime[path.extname(previewFile)] || "application/octet-stream"); }
    const relative = url.pathname === "/" ? "/desktop/renderer/index.html" : url.pathname; const file = path.resolve(root, `.${relative}`); if (!file.startsWith(root) || file.includes(`${path.sep}..${path.sep}`)) return send(res, 403, { error: "Forbidden" }); let data = await fs.readFile(file); if (path.extname(file) === ".html") { const shim = '<script>window.websiteCloner=window.websiteCloner||{chooseOutputDir:async()=>"",startMirror:async p=>(await fetch("/api/mirror",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(p)})).json(),openPath:async()=>{},onProgress:cb=>{const t=setInterval(async()=>{if(!window.__job)return;const e=await (await fetch(`/api/mirror/${window.__job.id}`)).json();cb({id:window.__job.id,status:e.status,result:e.result,error:e.error,...e.progress});if(e.status!=="running")clearInterval(t)},1000);return()=>clearInterval(t)}};</script>'; data = Buffer.from(data.toString().replace("<script src=\"app.js\">", `${shim}<script src=\"app.js\">`)); } send(res, 200, data, mime[path.extname(file)] || "application/octet-stream");
  } catch (error) { send(res, error.code === "ENOENT" ? 404 : 400, { error: error.message }); }
});
server.listen(port, "127.0.0.1", () => console.log(`Website Cloner HTTP server: http://127.0.0.1:${port}`));
