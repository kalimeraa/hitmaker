const express = require("express");
const cookiePoolController = require("../app/Http/Controllers/cookiePoolController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => cookiePoolController.index(req, res)));
router.post("/", asyncHandler((req, res) => cookiePoolController.store(req, res)));
router.put("/:id", asyncHandler((req, res) => cookiePoolController.update(req, res)));
router.patch("/:id/status", asyncHandler((req, res) => cookiePoolController.updateStatus(req, res)));
router.delete("/:id", asyncHandler((req, res) => cookiePoolController.destroy(req, res)));

module.exports = router;
