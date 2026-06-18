const mongoose = require("mongoose");

const gmailCreatorJobSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["queued", "running", "awaiting_manual", "completed", "failed"],
      default: "queued"
    },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    username: { type: String, default: "" },
    email: { type: String, default: "" },
    password: { type: String, default: "" },
    birthday: {
      day: Number,
      month: Number,
      year: Number
    },
    proxyUrl: { type: String, default: "" },
    deviceMode: { type: String, enum: ["desktop", "mobile"], default: "desktop" },
    profileKey: { type: String, default: "" },
    accountId: { type: String, default: "" },
    attempt: { type: Number, default: 1 },
    maxAttempts: { type: Number, default: 1 },
    proxyResetUrl: { type: String, default: "" },
    notes: { type: String, default: "" },
    lastUrl: { type: String, default: "" },
    lastError: { type: String, default: "" },
    failureReason: { type: String, default: "" },
    manualHint: { type: String, default: "" },
    startedAt: Date,
    completedAt: Date
  },
  { timestamps: true }
);

gmailCreatorJobSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    ret.hasPassword = Boolean(ret.password);
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("GmailCreatorJob", gmailCreatorJobSchema);
