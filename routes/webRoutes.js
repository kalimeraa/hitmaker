const express = require("express");
const homeController = require("../app/Http/Controllers/homeController");

const router = express.Router();

router.get("/", (req, res) => homeController.index(req, res));

module.exports = router;
