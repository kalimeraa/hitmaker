const mrLoginService = require("../../Services/mrLoginService");

class MrLoginController {
  async index(req, res) {
    const jobs = await mrLoginService.listJobs();
    res.json(jobs);
  }

  async launch(req, res) {
    const job = await mrLoginService.launch(req.body);
    res.status(202).json(job);
  }

  async emailCode(req, res) {
    const job = await mrLoginService.submitEmailCode(req.params.id, req.body);
    if (!job) return res.status(404).json({ error: "MR login job not found" });
    res.json(job);
  }
}

module.exports = new MrLoginController();
