const mongoose = require("mongoose");

const runSchema = new mongoose.Schema(
  {
    keyword: String,
    attempts: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["queued", "running", "clicked", "not_found", "blocked_by_google", "failed"],
      default: "queued"
    },
    matchedUrl: String,
    resultPage: Number,
    resultRank: Number,
    error: String,
    searchUrl: String,
    lastGoogleUrl: String,
    googleBlocked: { type: Boolean, default: false },
    candidates: [
      new mongoose.Schema(
        {
          pageNumber: Number,
          rank: Number,
          host: String,
          path: String,
          href: String,
          text: String
        },
        { _id: false }
      )
    ],
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
    maxAttempts: { type: Number, default: 3, min: 1, max: 10 },
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
    runVersion: { type: Number, default: 0 },
    progress: { type: Number, default: 0 },
    error: String,
    runs: [runSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", taskSchema);
