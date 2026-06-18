const express = require("express");
const gmailCreatorController = require("../app/Http/Controllers/gmailCreatorController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => gmailCreatorController.index(req, res)));
router.post("/", asyncHandler((req, res) => gmailCreatorController.store(req, res)));
router.get("/:id", asyncHandler((req, res) => gmailCreatorController.show(req, res)));
router.post("/:id/retry", asyncHandler((req, res) => gmailCreatorController.retry(req, res)));
router.delete("/:id", asyncHandler((req, res) => gmailCreatorController.destroy(req, res)));

module.exports = router;
