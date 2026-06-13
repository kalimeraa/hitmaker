const { logger } = require("../../Services/logService");

function resolveStatusCode(error) {
  const statusCode = Number(error.statusCode || error.status || 500);
  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
    return 500;
  }
  return statusCode;
}

function resolveErrorMessage(error, statusCode) {
  if (error.type === "entity.too.large") {
    return `Request payload too large. Limit is ${error.limit ? Math.ceil(error.limit / 1024 / 1024) : "configured"} MB.`;
  }
  if (error.type === "entity.parse.failed") {
    return `Invalid JSON payload: ${error.message}`;
  }
  if (error.message) {
    return error.message;
  }
  return statusCode >= 500 ? "Internal server error" : "Request failed";
}

function errorHandler(error, req, res, next) {
  const statusCode = resolveStatusCode(error);
  const message = resolveErrorMessage(error, statusCode);

  if (statusCode >= 500) {
    logger.error(error.message, {
      stack: error.stack,
      path: req.originalUrl,
      method: req.method,
      statusCode
    });
  }

  res.status(statusCode).json({
    error: message,
    statusCode
  });
}

module.exports = { errorHandler };
