const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { assertSafeBuildDirectory } = require("./payload");

const root = path.resolve(__dirname, "../..");
const mounts = [
  [root, "/source", "ro"],
  [path.join(root, "storage/installer-cache"), "/cache", "rw"],
  [path.join(root, "storage/installer-build"), "/work", "rw"],
  [path.join(root, "dist/windows"), "/out", "rw"]
];
assertSafeBuildDirectory(root, mounts[2][0]);
for (const [host] of mounts.slice(1)) fs.mkdirSync(host, { recursive: true });

function run(args) {
  const result = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
  if (result.error) throw new Error(`Docker is required to build the installer: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);
}

run(["build", "-f", "packaging/windows/Dockerfile", "-t", "hitmaker-windows-installer-builder", "."]);
run(["run", "--rm", ...mounts.flatMap(([host, target, mode]) => ["-v", `${host}:${target}:${mode}`]), "hitmaker-windows-installer-builder"]);
