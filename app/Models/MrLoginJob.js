const mongoose = require("mongoose");

const mrLoginJobSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed"],
      default: "queued"
    },
    email: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    loginUrl: { type: String, default: "https://mrking5018.com/auth/login" },
    profileKey: { type: String, default: "" },
    cookieCount: { type: Number, default: 0 },
    cookies: { type: Array, default: [] },
    session: {
      url: { type: String, default: "" },
      localStorage: { type: Array, default: [] },
      sessionStorage: { type: Array, default: [] }
    },
    emailAuthCode: { type: String, default: "" },
    emailAuthCodeSubmittedAt: Date,
    logs: [
      {
        at: { type: Date, default: Date.now },
        event: { type: String, default: "" },
        message: { type: String, default: "" },
        meta: { type: Object, default: {} }
      }
    ],
    lastUrl: { type: String, default: "" },
    lastError: { type: String, default: "" },
    startedAt: Date,
    completedAt: Date
  },
  { timestamps: true }
);

mrLoginJobSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    ret.hasPassword = Boolean(ret.password);
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("MrLoginJob", mrLoginJobSchema);
