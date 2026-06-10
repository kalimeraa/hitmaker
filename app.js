const path = require("path");
const express = require("express");
const apiRoutes = require("./routes");
const authRoutes = require("./routes/authRoutes");
const webRoutes = require("./routes/webRoutes");
const { requireAuth } = require("./app/Http/Middleware/authMiddleware");
const { errorHandler } = require("./app/Http/Middleware/errorHandler");
const { requestLogger } = require("./app/Http/Middleware/requestLogger");

function createApp() {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(requestLogger);
  app.use(express.static(path.join(__dirname, "public")));
  app.use(authRoutes);
  app.use(requireAuth);
  app.use("/", webRoutes);
  app.use("/api", apiRoutes);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
