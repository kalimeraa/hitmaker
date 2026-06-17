const express = require("express");
const googleAuthController = require("../app/Http/Controllers/googleAuthController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => googleAuthController.index(req, res)));
router.post("/", asyncHandler((req, res) => googleAuthController.store(req, res)));
router.post("/import", asyncHandler((req, res) => googleAuthController.import(req, res)));
router.get("/cookies/download-all", asyncHandler((req, res) => googleAuthController.downloadAllCookies(req, res)));
router.delete("/", asyncHandler((req, res) => googleAuthController.destroyAll(req, res)));
router.put("/:id", asyncHandler((req, res) => googleAuthController.update(req, res)));
router.post("/:id/cookies", asyncHandler((req, res) => googleAuthController.generateCookies(req, res)));
router.get("/:id/cookies/download", asyncHandler((req, res) => googleAuthController.downloadCookies(req, res)));
router.delete("/:id", asyncHandler((req, res) => googleAuthController.destroy(req, res)));

module.exports = router;
