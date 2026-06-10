const { headlessDefault } = require("../../../config/app");

class HomeController {
  index(req, res) {
    res.render("layouts/main", {
      title: "Hitmaker Task Runner",
      view: "home/index",
      showNavbar: true,
      loadAppScript: true,
      headlessDefault
    });
  }
}

module.exports = new HomeController();
