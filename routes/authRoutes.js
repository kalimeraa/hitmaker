const express = require("express");
const authController = require("../app/Http/Controllers/authController");

const router = express.Router();

router.get("/login", (req, res) => authController.showLogin(req, res));
router.post("/login", (req, res) => authController.login(req, res));
router.get("/logout", (req, res) => authController.logout(req, res));
router.post("/logout", (req, res) => authController.logout(req, res));

module.exports = router;
