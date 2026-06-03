const express = require("express");
const logController = require("../app/Http/Controllers/logController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => logController.index(req, res)));

module.exports = router;
