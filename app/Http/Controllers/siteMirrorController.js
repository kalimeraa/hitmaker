const express = require("express");
const siteMirrorService = require("../../Services/siteMirrorService");
const siteMirrorJobService = require("../../Services/siteMirrorJobService");

class SiteMirrorController {
  async index(req, res) {
    const sites = await siteMirrorService.listSites();
    res.json(sites);
  }

  // Arka planda job başlatır; anında jobId döner (crawl HTTP isteğini bloklamaz).
  async mirror(req, res) {
    const job = siteMirrorJobService.start(req.body);
    res.status(202).json(job);
  }

  listJobs(req, res) {
    res.json(siteMirrorJobService.list());
  }

  getJob(req, res) {
    const job = siteMirrorJobService.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job bulunamadı" });
      return;
    }
    res.json(job);
  }

  async pauseJob(req, res) {
    res.json(await siteMirrorJobService.pause(req.params.id));
  }

  async resumeJob(req, res) {
    res.json(await siteMirrorJobService.resume(req.params.id));
  }

  async stopJob(req, res) {
    res.json(await siteMirrorJobService.stop(req.params.id));
  }

  async reprocess(req, res) {
    const result = await siteMirrorService.reprocessSite(req.params.slug);
    if (!result) {
      res.status(404).json({ error: "Mirror bulunamadı" });
      return;
    }
    res.json(result);
  }

  async download(req, res) {
    const buffer = await siteMirrorService.zipSite(req.params.slug);
    if (!buffer) {
      res.status(404).json({ error: "Mirror bulunamadı" });
      return;
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.slug}.zip"`);
    res.send(buffer);
  }

  async destroy(req, res) {
    const removed = await siteMirrorService.deleteSite(req.params.slug);
    if (!removed) {
      res.status(404).json({ error: "Mirror bulunamadı" });
      return;
    }
    res.status(204).end();
  }

  // Mirror klasörünü statik sun; kök istek giriş sayfasına yönlendirilir.
  serve(req, res, next) {
    const dir = siteMirrorService.resolveSiteDir(req.params.slug);
    if (!dir) {
      res.status(404).send("Mirror bulunamadı");
      return;
    }

    if (req.path === "/") {
      siteMirrorService
        .getEntry(req.params.slug)
        .then((entry) => {
          if (!entry) {
            res.status(404).send("Bu mirror için giriş sayfası yok");
            return;
          }
          res.redirect(`${req.originalUrl.split("?")[0].replace(/\/+$/, "")}/${entry}`);
        })
        .catch(next);
      return;
    }

    express.static(dir)(req, res, next);
  }
}

module.exports = new SiteMirrorController();
