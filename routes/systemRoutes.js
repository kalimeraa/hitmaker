const express = require("express");
const eventController = require("../controllers/eventController");
const healthController = require("../controllers/healthController");

const router = express.Router();

router.get("/health", healthController.show);
router.get("/events", eventController.stream);

module.exports = router;
