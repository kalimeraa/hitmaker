const cookiePoolRepository = require("../Repositories/cookiePoolRepository");
const realtimeEventService = require("./realtimeEventService");
const { logger } = require("./logService");
const {
  validateCookiePoolImportPayload,
  validateCookiePoolUpdatePayload,
  validateCookiePoolStatusPayload
} = require("../Validators/cookiePoolValidator");

class CookiePoolService {
  constructor(repository = cookiePoolRepository) {
    this.repository = repository;
  }

  listCookies() {
    return this.repository.findRecent(200);
  }

  listActiveCookies() {
    return this.repository.findActive(200);
  }

  async importCookies(payload) {
    const validated = validateCookiePoolImportPayload(payload);
    const items = validated.cookieSets.map((cookieSet) => ({
      name: cookieSet.name,
      notes: validated.notes,
      cookies: cookieSet.cookies,
      status: "active"
    }));

    const created = await this.repository.createMany(items);
    logger.info("cookie_pool_imported", { count: created.length });
    await realtimeEventService.publish("cookie.updated", { action: "imported", count: created.length });
    return created.map((item) => item.toObject ? item.toObject() : item);
  }

  async updateCookie(id, payload) {
    const validated = validateCookiePoolUpdatePayload(payload);
    const cookie = await this.repository.updateDetails(id, validated);
    if (cookie) {
      logger.info("cookie_pool_updated", { cookieId: String(id), name: cookie.name });
      await realtimeEventService.publish("cookie.updated", { action: "updated", cookieId: String(id) });
    }
    return cookie;
  }

  async updateStatus(id, payload) {
    const validated = validateCookiePoolStatusPayload(payload);
    const cookie = await this.repository.updateStatus(id, validated.status, validated.reason);
    if (cookie) {
      logger.info("cookie_pool_status_updated", { cookieId: String(id), status: cookie.status });
      await realtimeEventService.publish("cookie.updated", { action: "status_updated", cookieId: String(id), status: cookie.status });
    }
    return cookie;
  }

  async markUsed(id, payload) {
    if (!id) return null;
    const cookie = await this.repository.markUsed(id, payload);
    if (cookie) {
      await realtimeEventService.publish("cookie.updated", { action: "used", cookieId: String(id) });
    }
    return cookie;
  }

  async markBroken(id, reason) {
    if (!id) return null;
    const cookie = await this.repository.markBroken(id, reason);
    if (cookie) {
      logger.info("cookie_pool_marked_broken", { cookieId: String(id), name: cookie.name, reason });
      await realtimeEventService.publish("cookie.updated", { action: "marked_broken", cookieId: String(id), reason });
    }
    return cookie;
  }

  async deleteCookie(id) {
    const cookie = await this.repository.deleteById(id);
    if (cookie) {
      logger.info("cookie_pool_deleted", { cookieId: String(id), name: cookie.name });
      await realtimeEventService.publish("cookie.updated", { action: "deleted", cookieId: String(id) });
    }
    return cookie;
  }
}

module.exports = new CookiePoolService();
