class HealthController {
  show(req, res) {
    res.json({ ok: true });
  }
}

module.exports = new HealthController();
