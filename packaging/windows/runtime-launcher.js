const path = require("node:path");

const entries = new Map([
  ["server.js", "web"], ["worker.js", "worker"], ["mrLoginWorker.js", "mr-worker"]
]);
const entry = process.argv[2];
if (!entries.has(entry)) throw new Error("Unknown Hitmaker service entry point");
const appRoot = path.resolve(__dirname, "../app");
// WinSW runs in the protected, persistent ProgramData directory.
require(path.join(appRoot, "node_modules/dotenv")).config({ path: path.join(process.cwd(), ".env"), override: true });
process.env.SERVICE_NAME = entries.get(entry);
require(path.join(appRoot, entry));
