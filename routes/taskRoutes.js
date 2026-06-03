const express = require("express");
const taskController = require("../controllers/taskController");
const { asyncHandler } = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => taskController.index(req, res)));
router.get("/:id", asyncHandler((req, res) => taskController.show(req, res)));
router.post("/", asyncHandler((req, res) => taskController.store(req, res)));

module.exports = router;
