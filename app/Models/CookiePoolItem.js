const mongoose = require("mongoose");

const cookieSchema = new mongoose.Schema(
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
);

const cookiePoolItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    notes: String,
    sourceType: String,
    sourceAccountId: String,
    profileKey: String,
    sourceProxyHost: String,
    cookies: [cookieSchema],
    status: {
      type: String,
      enum: ["active", "disabled", "broken"],
      default: "active"
    },
    disabledReason: String,
    failureCount: { type: Number, default: 0 },
    lastFailureAt: Date,
    lastUsedAt: Date,
    lastTaskId: String,
    lastRunIndex: Number,
    lastExitIp: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("CookiePoolItem", cookiePoolItemSchema);
