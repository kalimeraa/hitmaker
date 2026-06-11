const cookiePoolService = require("../../Services/cookiePoolService");

class CookiePoolController {
  async index(req, res) {
    const cookies = await cookiePoolService.listCookies();
    res.json(cookies);
  }

  async store(req, res) {
    const cookies = await cookiePoolService.importCookies(req.body);
    res.status(201).json(cookies);
  }

  async update(req, res) {
    const cookie = await cookiePoolService.updateCookie(req.params.id, req.body);
    if (!cookie) return res.status(404).json({ error: "Cookie not found" });
    res.json(cookie);
  }

  async updateStatus(req, res) {
    const cookie = await cookiePoolService.updateStatus(req.params.id, req.body);
    if (!cookie) return res.status(404).json({ error: "Cookie not found" });
    res.json(cookie);
  }

  async destroy(req, res) {
    const cookie = await cookiePoolService.deleteCookie(req.params.id);
    if (!cookie) return res.status(404).json({ error: "Cookie not found" });
    res.json(cookie);
  }
}

module.exports = new CookiePoolController();
