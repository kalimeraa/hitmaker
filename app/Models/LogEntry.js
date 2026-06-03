const mongoose = require("mongoose");

const logEntrySchema = new mongoose.Schema(
  {
    level: { type: String, index: true },
    message: String,
    meta: mongoose.Schema.Types.Mixed,
    service: String
  },
  { timestamps: true }
);

logEntrySchema.index({ createdAt: -1 });

module.exports = mongoose.model("LogEntry", logEntrySchema);
