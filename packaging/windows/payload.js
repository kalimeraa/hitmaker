const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");

const APP_DIRECTORIES = ["app", "bootstrap", "config", "public", "routes", "views"];
const APP_FILES = ["app.js", "server.js", "worker.js", "mrLoginWorker.js", "package.json", "package-lock.json"];

async function walk(root, relative = "", includeHidden = false) {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Payload contains a symbolic link: ${name}`);
    if (!includeHidden && entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) files.push(...await walk(root, name, includeHidden));
    else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}

async function collectAppFiles(root) {
  const files = [];
  for (const name of [...APP_FILES, ...APP_DIRECTORIES]) {
    let stat;
    try { stat = await fs.lstat(path.join(root, name)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Payload contains a symbolic link: ${name}`);
    if (stat.isDirectory()) files.push(...(await walk(root, name)));
    else if (stat.isFile()) files.push(name);
  }
  return files.sort();
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyFile(file, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("A pinned SHA-256 checksum is required");
  const actual = await sha256(file);
  if (actual !== expected) throw new Error(`SHA-256 mismatch: ${path.basename(file)}`);
}

function assertSafeBuildDirectory(root, directory) {
  const relative = path.relative(path.resolve(root), path.resolve(directory));
  if (!(relative === path.join("storage", "installer-build") || relative.startsWith(path.join("storage", "installer-build") + path.sep))) {
    throw new Error(`Unsafe build directory: ${directory}`);
  }
}

async function verifyPe(file, machine) {
  const handle = await fs.open(file, "r");
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, 64, 0);
    if (bytesRead !== 64 || header.toString("ascii", 0, 2) !== "MZ") throw new Error(`Invalid PE executable: ${file}`);
    const offset = header.readUInt32LE(60);
    if (offset < 64 || offset > 1024 * 1024) throw new Error(`Invalid PE header offset: ${file}`);
    const pe = Buffer.alloc(6);
    await handle.read(pe, 0, 6, offset);
    if (pe.toString("ascii", 0, 4) !== "PE\0\0") throw new Error(`Invalid PE signature: ${file}`);
    if (pe.readUInt16LE(4) !== machine) throw new Error(`Unexpected PE machine: ${file}`);
  } finally { await handle.close(); }
}

async function createIntegrityManifest(root) {
  const entries = [];
  for (const file of await walk(root, "", true)) {
    if (file === "integrity.json") continue;
    const absolute = path.join(root, file);
    entries.push({ path: file, size: (await fs.stat(absolute)).size, sha256: await sha256(absolute) });
  }
  return entries;
}

module.exports = { collectAppFiles, sha256, verifyFile, assertSafeBuildDirectory, verifyPe, createIntegrityManifest };
