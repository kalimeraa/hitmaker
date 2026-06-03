const express = require("express");
const errorRoutes = require("./errorRoutes");
const logRoutes = require("./logRoutes");
const systemRoutes = require("./systemRoutes");
const taskRoutes = require("./taskRoutes");

const router = express.Router();

router.use(systemRoutes);
router.use("/tasks", taskRoutes);
router.use("/logs", logRoutes);
router.use("/errors", errorRoutes);

module.exports = router;
