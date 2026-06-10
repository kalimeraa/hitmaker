const authService = require("../../Services/authService");
const { validateLoginPayload, normalizeRedirectPath } = require("../../Validators/authValidator");

class AuthController {
  showLogin(req, res) {
    if (authService.isAuthenticated(req)) {
      res.redirect(normalizeRedirectPath(req.query.next));
      return;
    }

    this.renderLogin(res, {
      nextPath: normalizeRedirectPath(req.query.next),
      error: ""
    });
  }

  login(req, res) {
    const credentials = validateLoginPayload(req.body);
    const nextPath = normalizeRedirectPath(req.body.next);

    if (!authService.canLogin(credentials)) {
      this.renderLogin(res.status(401), {
        nextPath,
        error: "Kullanıcı adı veya şifre hatalı."
      });
      return;
    }

    authService.attachSession(res);
    res.redirect(nextPath);
  }

  logout(req, res) {
    authService.clearSession(res);
    res.redirect("/login");
  }

  renderLogin(res, data) {
    res.render("layouts/main", {
      title: "Hitmaker Giriş",
      view: "auth/login",
      showNavbar: false,
      loadAppScript: false,
      ...data
    });
  }
}

module.exports = new AuthController();
