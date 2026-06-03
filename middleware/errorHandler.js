const { logger } = require("../services/logService");

function errorHandler(error, req, res, next) {
  if (!error.statusCode || error.statusCode >= 500) {
    logger.error(error.message, {
      stack: error.stack,
      path: req.originalUrl,
      method: req.method
    });
  }
  res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : "Internal server error"
  });
}

module.exports = { errorHandler };
