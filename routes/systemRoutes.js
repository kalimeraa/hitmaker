const express = require("express");
const eventController = require("../app/Http/Controllers/eventController");
const healthController = require("../app/Http/Controllers/healthController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/health", healthController.show);
router.get("/events", asyncHandler((req, res) => eventController.stream(req, res)));

module.exports = router;
