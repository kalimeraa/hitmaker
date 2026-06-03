const express = require("express");
const taskController = require("../app/Http/Controllers/taskController");
const { asyncHandler } = require("../app/Http/Middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler((req, res) => taskController.index(req, res)));
router.get("/:id", asyncHandler((req, res) => taskController.show(req, res)));
router.post("/", asyncHandler((req, res) => taskController.store(req, res)));
router.post("/:id/runs/:runIndex/retry", asyncHandler((req, res) => taskController.retryRun(req, res)));
router.delete("/:id", asyncHandler((req, res) => taskController.destroy(req, res)));

module.exports = router;
