const express = require("express");
const errorRoutes = require("./errorRoutes");
const logRoutes = require("./logRoutes");
const systemRoutes = require("./systemRoutes");
const taskRoutes = require("./taskRoutes");
const cookiePoolRoutes = require("./cookiePoolRoutes");
const googleAuthRoutes = require("./googleAuthRoutes");
const gmailCreatorRoutes = require("./gmailCreatorRoutes");

const router = express.Router();

router.use(systemRoutes);
router.use("/tasks", taskRoutes);
router.use("/cookies", cookiePoolRoutes);
router.use("/google-auth", googleAuthRoutes);
router.use("/gmail-creator", gmailCreatorRoutes);
router.use("/logs", logRoutes);
router.use("/errors", errorRoutes);

module.exports = router;
