const express = require("express");
const eventController = require("../app/Http/Controllers/eventController");
const healthController = require("../app/Http/Controllers/healthController");

const router = express.Router();

router.get("/health", healthController.show);
router.get("/events", eventController.stream);

module.exports = router;
