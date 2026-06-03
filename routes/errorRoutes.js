const express = require("express");
const logController = require("../controllers/logController");
const { asyncHandler } = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => logController.errors(req, res)));

module.exports = router;
