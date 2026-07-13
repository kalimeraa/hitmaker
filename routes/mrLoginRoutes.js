const express = require("express");
const mrLoginController = require("../app/Http/Controllers/mrLoginController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => mrLoginController.index(req, res)));
router.post("/warmup", asyncHandler((req, res) => mrLoginController.warmup(req, res)));
router.post("/credentials", asyncHandler((req, res) => mrLoginController.credentials(req, res)));
router.post("/launch", asyncHandler((req, res) => mrLoginController.launch(req, res)));
router.post("/:id/email-code", asyncHandler((req, res) => mrLoginController.emailCode(req, res)));

module.exports = router;
