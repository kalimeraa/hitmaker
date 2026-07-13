const express = require("express");
const siteMirrorController = require("../app/Http/Controllers/siteMirrorController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => siteMirrorController.index(req, res)));
router.post("/", asyncHandler((req, res) => siteMirrorController.mirror(req, res)));

// Job kontrol endpoint'leri (literal "jobs" prefix'i /:slug'tan önce tanımlanır).
router.get("/jobs", (req, res) => siteMirrorController.listJobs(req, res));
router.get("/jobs/:id", (req, res) => siteMirrorController.getJob(req, res));
router.post("/jobs/:id/pause", asyncHandler((req, res) => siteMirrorController.pauseJob(req, res)));
router.post("/jobs/:id/resume", asyncHandler((req, res) => siteMirrorController.resumeJob(req, res)));
router.post("/jobs/:id/stop", asyncHandler((req, res) => siteMirrorController.stopJob(req, res)));

router.post("/:slug/reprocess", asyncHandler((req, res) => siteMirrorController.reprocess(req, res)));
router.get("/:slug/download", asyncHandler((req, res) => siteMirrorController.download(req, res)));
router.delete("/:slug", asyncHandler((req, res) => siteMirrorController.destroy(req, res)));
router.use("/serve/:slug", (req, res, next) => siteMirrorController.serve(req, res, next));

module.exports = router;
