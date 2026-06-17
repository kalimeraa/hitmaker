const googleAuthService = require("../../Services/googleAuthService");

class GoogleAuthController {
  async index(req, res) {
    const accounts = await googleAuthService.listAccounts();
    res.json(accounts);
  }

  async store(req, res) {
    const account = await googleAuthService.createAccount(req.body);
    res.status(201).json(account);
  }

  async update(req, res) {
    const account = await googleAuthService.updateAccount(req.params.id, req.body);
    if (!account) return res.status(404).json({ error: "Google auth account not found" });
    res.json(account);
  }

  async import(req, res) {
    const result = await googleAuthService.importAccounts(req.body);
    res.status(201).json(result);
  }

  async generateCookies(req, res) {
    const result = await googleAuthService.generateCookies(req.params.id, req.body);
    res.status(201).json(result);
  }

  async downloadCookies(req, res) {
    const file = await googleAuthService.getCookieFile(req.params.id);
    res.download(file.filePath, file.fileName);
  }

  async downloadAllCookies(req, res) {
    const file = await googleAuthService.getCookieBundleFile();
    res.download(file.filePath, file.fileName);
  }

  async destroy(req, res) {
    const account = await googleAuthService.deleteAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "Google auth account not found" });
    res.json(account);
  }

  async destroyAll(req, res) {
    const result = await googleAuthService.deleteAllAccounts();
    res.json(result);
  }
}

module.exports = new GoogleAuthController();
