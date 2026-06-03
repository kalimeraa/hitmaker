class RunScheduleService {
  waitUntil(date) {
    if (!date) return Promise.resolve();

    const delayMs = new Date(date).getTime() - Date.now();
    if (delayMs <= 0) return Promise.resolve();

    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
}

module.exports = new RunScheduleService();
