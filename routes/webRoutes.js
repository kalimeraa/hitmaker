const express = require("express");
const homeController = require("../controllers/homeController");

const router = express.Router();

router.get("/", (req, res) => homeController.index(req, res));

module.exports = router;
