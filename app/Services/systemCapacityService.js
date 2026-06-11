const os = require("os");
const { maxParallelBrowsers } = require("../../config/app");
const { estimateBrowserCapacity } = require("../Domain/browserCapacityAdvisor");

class SystemCapacityService {
  browserCapacity() {
    return estimateBrowserCapacity({
      cpuCores: os.cpus().length,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      maxParallelBrowsers
    });
  }
}

module.exports = new SystemCapacityService();
