const gmailCreatorService = require("../../Services/gmailCreatorService");

class GmailCreatorController {
  async index(req, res) {
    const jobs = await gmailCreatorService.listJobs();
    res.json(jobs);
  }

  async show(req, res) {
    const job = await gmailCreatorService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Gmail creator job not found" });
    res.json(job);
  }

  async store(req, res) {
    const result = await gmailCreatorService.createAndRun(req.body);
    res.status(201).json(result);
  }

  async retry(req, res) {
    const result = await gmailCreatorService.retryJob(req.params.id, req.body);
    res.json(result);
  }

  async destroy(req, res) {
    const job = await gmailCreatorService.deleteJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Gmail creator job not found" });
    res.json(job);
  }
}

module.exports = new GmailCreatorController();
