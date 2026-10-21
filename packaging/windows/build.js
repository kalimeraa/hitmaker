const fs = require("node:fs/promises");
const { createWriteStream } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const { collectAppFiles, sha256, verifyFile, verifyPe, createIntegrityManifest } = require("./payload");
const dependencies = require("./dependencies.json");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
const cache = "/cache";
const work = "/work";
const payload = path.join(work, "payload");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

async function download(asset) {
  const destination = path.join(cache, asset.file);
  try { await verifyFile(destination, asset.sha256); return destination; }
  catch (error) { if (error.code !== "ENOENT") await fs.rm(destination, { force: true }); }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const temporary = destination + ".part";
    try {
      console.log(`Downloading ${asset.id} ${asset.version} (${attempt}/3)`);
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${asset.id}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
      await verifyFile(temporary, asset.sha256);
      await fs.rename(temporary, destination);
      return destination;
    } catch (error) {
      await fs.rm(temporary, { force: true });
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}

async function copy(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, errorOnExist: true });
}

async function stageAsset(asset) {
  const archive = await download(asset);
  const runtime = path.join(payload, "runtime", asset.id);
  await fs.mkdir(runtime, { recursive: true });
  if (!asset.file.endsWith(".zip")) {
    await copy(archive, path.join(runtime, asset.id === "winsw" ? "WinSW.exe" : "vc_redist.x64.exe"));
    return;
  }
  const extracted = path.join(work, "unpacked", asset.id);
  run("7z", ["x", "-y", "-bso0", "-bsp0", "-xr!*.pdb", `-o${extracted}`, archive]);
  let source = extracted;
  const entries = await fs.readdir(extracted, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) source = path.join(source, entries[0].name);
  if (asset.id === "node") {
    for (const name of ["node.exe", "LICENSE"]) await copy(path.join(source, name), path.join(runtime, name));
  } else if (asset.id === "mongodb") {
    for (const name of ["LICENSE-Community.txt", "MPL-2", "README", "THIRD-PARTY-NOTICES", "bin/mongod.exe"]) {
      await copy(path.join(source, name), path.join(runtime, name));
    }
  } else {
    await fs.cp(source, runtime, { recursive: true });
  }
}

async function build() {
  await fs.mkdir(cache, { recursive: true });
  await fs.rm(payload, { recursive: true, force: true });
  await fs.rm(path.join(work, "unpacked"), { recursive: true, force: true });
  const app = path.join(payload, "app");
  for (const file of await collectAppFiles(root)) await copy(path.join(root, file), path.join(app, file));
  const pkg = JSON.parse(await fs.readFile(path.join(app, "package.json"), "utf8"));
  console.log("Installing Windows production dependencies from package-lock.json");
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--os=win32", "--cpu=x64", "--no-audit", "--no-fund", "--cache", path.join(cache, "npm")], { cwd: app });
  // npm's executable shims are unnecessary at runtime and may be host symlinks.
  await fs.rm(path.join(app, "node_modules/.bin"), { recursive: true, force: true });
  for (const asset of dependencies.assets) await stageAsset(asset);
  // Cygwin locates /etc beside the directory containing cygwin1.dll (runtime/redis).
  await copy(path.join(__dirname, "cygwin.fstab"), path.join(payload, "runtime/etc/fstab"));
  for (const name of ["install.ps1", "Installer.psm1", "runtime-launcher.js", "check-runtime.js"]) {
    await copy(path.join(__dirname, name), path.join(payload, "installer", name));
  }
  await copy(path.join(__dirname, "THIRD-PARTY-NOTICES.txt"), path.join(payload, "THIRD-PARTY-NOTICES.txt"));
  await copy(path.join(__dirname, "dependencies.json"), path.join(payload, "dependencies.json"));
  for (const file of ["runtime/node/node.exe", "runtime/mongodb/bin/mongod.exe", "runtime/redis/redis-server.exe", "runtime/browser/chrome.exe", "runtime/winsw/WinSW.exe", "runtime/vcredist/vc_redist.x64.exe"]) {
    await verifyPe(path.join(payload, file), file.includes("vcredist") ? 0x14c : 0x8664);
  }
  await fs.writeFile(path.join(payload, "version.json"), JSON.stringify({ product: "Hitmaker", version: pkg.version, architecture: "x64" }, null, 2));
  const integrity = await createIntegrityManifest(payload);
  await fs.writeFile(path.join(payload, "integrity.json"), JSON.stringify({ files: integrity }, null, 2));
  const output = `/out/Hitmaker-${pkg.version}-Setup-x64.exe`;
  console.log(`Payload: ${integrity.length} files, ${Math.ceil(integrity.reduce((sum, file) => sum + file.size, 0) / 1048576)} MiB`);
  run("makensis", ["-V3", `-DPAYLOAD=${payload}`, `-DOUTPUT=${output}`, `-DVERSION=${pkg.version}`, path.join(__dirname, "Hitmaker.nsi")]);
  await verifyPe(output, 0x14c);
  const verified = path.join(work, "verified-installer");
  await fs.rm(verified, { recursive: true, force: true });
  run("7z", ["x", "-y", "-bso0", "-bsp0", `-o${verified}`, output]);
  const extractedPayload = path.join(verified, "$PLUGINSDIR", "payload");
  const archivedManifest = JSON.parse(await fs.readFile(path.join(extractedPayload, "integrity.json"), "utf8"));
  assert.deepEqual(archivedManifest.files, integrity, "Compiled installer manifest differs from staged payload");
  assert.deepEqual(await createIntegrityManifest(extractedPayload), integrity, "Compiled installer files failed SHA-256 verification");
  console.log(`PASS extracted installer: ${integrity.length} files match their SHA-256 hashes`);
  await fs.writeFile(output + ".sha256", `${await sha256(output)}  ${path.basename(output)}\n`);
  await fs.copyFile(path.join(payload, "integrity.json"), "/out/payload-integrity.json");
  console.log(`Built ${output}`);
}

build().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
