function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function estimateBrowserCapacity({ cpuCores, totalMemoryMb, freeMemoryMb, maxParallelBrowsers }) {
  const safeCpuCores = Math.max(1, Number(cpuCores) || 1);
  const safeTotalMemoryMb = Math.max(512, Number(totalMemoryMb) || 512);
  const safeFreeMemoryMb = Math.max(0, Number(freeMemoryMb) || 0);
  const hardLimit = Math.max(2, Number(maxParallelBrowsers) || 2);

  const reservedMemoryMb = Math.max(1024, Math.round(safeTotalMemoryMb * 0.25));
  const usableMemoryMb = Math.max(0, safeFreeMemoryMb - reservedMemoryMb);
  const memoryBased = Math.max(2, Math.floor(usableMemoryMb / 900));
  const cpuBased = Math.max(2, Math.floor(safeCpuCores * 0.75));
  const recommended = clamp(Math.min(memoryBased, cpuBased, hardLimit), 2, hardLimit);

  return {
    recommended,
    maxAllowed: hardLimit,
    cpuCores: safeCpuCores,
    totalMemoryMb: safeTotalMemoryMb,
    freeMemoryMb: safeFreeMemoryMb,
    usableMemoryMb,
    perBrowserMemoryMb: 900
  };
}

module.exports = { estimateBrowserCapacity };
