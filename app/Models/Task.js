const mongoose = require("mongoose");

const runSchema = new mongoose.Schema(
  {
    keyword: String,
    status: {
      type: String,
      enum: ["queued", "running", "clicked", "not_found", "failed"],
      default: "queued"
    },
    matchedUrl: String,
    resultPage: Number,
    error: String,
    scheduledAt: Date,
    startedAt: Date,
    finishedAt: Date
  },
  { _id: false }
);

const taskSchema = new mongoose.Schema(
  {
    keywords: [String],
    targetAddress: { type: String, required: true },
    count: { type: Number, required: true, min: 1, max: 50 },
    durationHours: { type: Number, default: 0, min: 0 },
    headless: { type: Boolean, default: true },
    proxyUrl: String,
    cookies: [
      new mongoose.Schema(
        {
          name: String,
          value: String,
          domain: String,
          path: String,
          expires: Number,
          httpOnly: Boolean,
          secure: Boolean,
          sameSite: String
        },
        { _id: false }
      )
    ],
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      default: "queued"
    },
    progress: { type: Number, default: 0 },
    error: String,
    runs: [runSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", taskSchema);
