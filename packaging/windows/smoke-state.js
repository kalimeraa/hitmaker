const assert = require("node:assert/strict");
const path = require("node:path");
const appRoot = path.join(process.argv[2], "current/app");
require(path.join(appRoot, "node_modules/dotenv")).config({ override: true });
const config = require(path.join(appRoot, "config/app"));
const mongoose = require(path.join(appRoot, "node_modules/mongoose"));
const Redis = require(path.join(appRoot, "node_modules/ioredis"));

(async () => {
  const redis = new Redis({ ...config.redis, maxRetriesPerRequest: 1 });
  redis.on("error", () => {});
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
    const collection = mongoose.connection.db.collection("installer_smoke");
    if (process.argv[3] === "write") {
      await collection.updateOne({ _id: "synthetic-probe" }, { $set: { value: "preserve-me" } }, { upsert: true });
      await redis.set("installer:synthetic-probe", "preserve-me");
      await redis.call("WAITAOF", 1, 0, 5000).catch(() => redis.bgsave());
    } else {
      assert.equal((await collection.findOne({ _id: "synthetic-probe" })).value, "preserve-me");
      assert.equal(await redis.get("installer:synthetic-probe"), "preserve-me");
    }
    console.log("PASS persistent MongoDB and Redis data");
  } finally { redis.disconnect(); await mongoose.disconnect(); }
})().then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(1); });
