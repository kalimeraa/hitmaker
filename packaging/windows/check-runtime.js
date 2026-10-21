const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const appRoot = path.resolve(__dirname, "../app");
require(path.join(appRoot, "node_modules/dotenv")).config({ path: path.join(process.cwd(), ".env"), override: true });
const config = require(path.join(appRoot, "config/app"));
const mongoose = require(path.join(appRoot, "node_modules/mongoose"));
const Redis = require(path.join(appRoot, "node_modules/ioredis"));
const { Queue } = require(path.join(appRoot, "node_modules/bullmq"));

async function probe() {
  const redis = new Redis({ ...config.redis, maxRetriesPerRequest: 1, connectTimeout: 5000 });
  const queues = [config.queueName, `${config.queueName}-mr-login`].map((name) => new Queue(name, { connection: { ...config.redis, maxRetriesPerRequest: 1 } }));
  redis.on("error", () => {});
  try {
    assert.equal(await redis.ping(), "PONG");
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    assert.equal((await mongoose.connection.db.command({ ping: 1 })).ok, 1);
    const base = `http://127.0.0.1:${config.port}`;
    const login = await fetch(`${base}/login`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: config.auth.username, password: config.auth.password })
    });
    assert.equal(login.status, 302, "Panel login failed");
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie, "Panel session missing");
    for (const endpoint of ["/", "/api/health", "/api/tasks"]) {
      const response = await fetch(`${base}${endpoint}`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `Panel endpoint failed: ${endpoint}`);
      if (endpoint === "/api/health") assert.equal((await response.json()).ok, true);
    }
    for (const queue of queues) assert.ok((await queue.getWorkers()).length > 0, `Worker not ready: ${queue.name}`);
  } finally {
    redis.disconnect();
    await Promise.all(queues.map((queue) => queue.close()));
    await mongoose.disconnect();
  }
}

async function main() {
  const deadline = Date.now() + 90000;
  while (true) {
    try { await probe(); break; }
    catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  console.log("PASS database, Redis, panel login, API and both workers");
  if (process.argv.includes("--browser")) {
    const { launchContext } = await import(pathToFileURL(path.join(appRoot, "node_modules/cloakbrowser/dist/index.js")).href);
    const context = await launchContext({ headless: true, humanize: false, viewport: { width: 800, height: 600 } });
    try {
      const page = await context.newPage();
      const base = `http://127.0.0.1:${config.port}`;
      const response = await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
      assert.equal(response.status(), 200, "Browser cannot open the local panel");
      await page.locator('input[name="username"]').fill(config.auth.username);
      await page.locator('input[name="password"]').fill(config.auth.password);
      await Promise.all([
        page.waitForURL(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30000 }),
        page.locator('form.login-form button[type="submit"]').click()
      ]);
      assert.match(await page.title(), /Hitmaker/i);
      assert.equal(await page.locator("#taskForm").count(), 1, "Authenticated task form missing");
    } finally { await context.close(); }
    console.log("PASS packaged Windows CloakBrowser: local panel navigation and form login (offline)");
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error.message); process.exit(1); });
