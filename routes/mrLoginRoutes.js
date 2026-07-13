const express = require("express");
const mrLoginController = require("../app/Http/Controllers/mrLoginController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => mrLoginController.index(req, res)));
router.get("/ready", asyncHandler((req, res) => mrLoginController.ready(req, res)));
router.get("/sessions", asyncHandler((req, res) => mrLoginController.index(req, res)));
router.post("/warmup", asyncHandler((req, res) => mrLoginController.warmup(req, res)));
router.post("/browsers", asyncHandler((req, res) => mrLoginController.warmup(req, res)));
router.post("/credentials", asyncHandler((req, res) => mrLoginController.credentials(req, res)));
router.post("/login", asyncHandler((req, res) => mrLoginController.credentials(req, res)));
router.post("/launch", asyncHandler((req, res) => mrLoginController.launch(req, res)));
router.post("/email-code", asyncHandler((req, res) => mrLoginController.emailCodeByPayload(req, res)));
router.post("/proxy-login", asyncHandler((req, res) => mrLoginController.proxyLogin(req, res)));
router.post("/login/:id/email-code", asyncHandler((req, res) => mrLoginController.emailCode(req, res)));
router.post("/:id/email-code", asyncHandler((req, res) => mrLoginController.emailCode(req, res)));

module.exports = router;
