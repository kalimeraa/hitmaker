const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectAppFiles, verifyFile, assertSafeBuildDirectory, verifyPe, createIntegrityManifest } = require("../packaging/windows/payload");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hitmaker-payload-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("payload includes application files and excludes local secrets and captures", async (t) => {
  const root = await fixture(t);
  for (const file of ["server.js", "worker.js", "mrLoginWorker.js", "app.js", "package.json", "package-lock.json", "app/Models/task.js", "views/home/index.ejs", "public/app.js", ".env", "storage/profiles/account/cookies.json", "htmls/login.html", "mock-sites/customer/index.html", "app/.env", "public/.DS_Store"]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), "fixture");
  }
  assert.deepEqual(await collectAppFiles(root), ["app.js", "app/Models/task.js", "mrLoginWorker.js", "package-lock.json", "package.json", "public/app.js", "server.js", "views/home/index.ejs", "worker.js"]);
});

test("payload refuses symlinks instead of following files outside the project", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "public"));
  await fs.symlink(os.tmpdir(), path.join(root, "public", "outside"), "dir");
  await assert.rejects(collectAppFiles(root), /symbolic link/i);
});

test("integrity verification rejects truncated and modified downloads", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "download.zip");
  const expected = createHash("sha256").update("complete").digest("hex");
  await fs.writeFile(file, "complete");
  await verifyFile(file, expected);
  await fs.writeFile(file, "corrupt");
  await assert.rejects(verifyFile(file, expected), /SHA-256/i);
});

test("build directory may not overwrite the repository, a parent, or application source", () => {
  const root = path.resolve("/tmp/hitmaker-project");
  for (const unsafe of [root, "/tmp", path.join(root, "app"), path.join(root, "views")]) {
    assert.throws(() => assertSafeBuildDirectory(root, unsafe), /build directory/i);
  }
  assert.doesNotThrow(() => assertSafeBuildDirectory(root, path.join(root, "storage", "installer-build")));
});

test("PE validation distinguishes Windows x64 programs from Linux and x86 files", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "node.exe");
  const bytes = Buffer.alloc(256);
  bytes.write("MZ"); bytes.writeUInt32LE(128, 60); bytes.write("PE\0\0", 128); bytes.writeUInt16LE(0x8664, 132);
  await fs.writeFile(file, bytes);
  await verifyPe(file, 0x8664);
  await assert.rejects(verifyPe(file, 0x14c), /machine/i);
  await fs.writeFile(file, "not a Windows executable");
  await assert.rejects(verifyPe(file, 0x8664), /PE/i);
});

test("integrity manifest covers every payload file with forward slash paths", async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, "runtime"));
  await fs.writeFile(path.join(root, "runtime", "node.exe"), "binary");
  await fs.writeFile(path.join(root, "version.json"), "{}");
  await fs.writeFile(path.join(root, ".hidden-runtime-file"), "metadata");
  const entries = await createIntegrityManifest(root);
  assert.deepEqual(entries.map((entry) => entry.path), [".hidden-runtime-file", "runtime/node.exe", "version.json"]);
  assert.equal(entries[1].sha256, createHash("sha256").update("binary").digest("hex"));
  assert.equal(entries[1].size, 6);
});
