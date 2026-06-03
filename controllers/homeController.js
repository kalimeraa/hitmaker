class HomeController {
  index(req, res) {
    res.render("layouts/main", {
      title: "Hitmaker Task Runner",
      view: "home/index"
    });
  }
}

module.exports = new HomeController();
