const path = require("path");
const express = require("express");
const apiRoutes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");
const { requestLogger } = require("./middleware/requestLogger");

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(requestLogger);
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/api", apiRoutes);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
