const mongoose = require("mongoose");

const googleAuthAccountSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    recoveryEmail: { type: String, trim: true, default: "" },
    recoveryPassword: { type: String, default: "" },
    phone: { type: String, trim: true, default: "" },
    twoFaSecret: { type: String, default: "" },
    proxyUrl: { type: String, default: "" },
    notes: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active"
    },
    lastCookiePoolId: String,
    lastCookieFilePath: String,
    lastCookieFileName: String,
    lastCookieGeneratedAt: Date,
    lastLoginUrl: String,
    lastError: String,
    // Son başarısız üretimi durduran Google challenge'ı: "" | "phone_verification" | "recaptcha_challenge"
    // | "2fa_challenge" | "unsafe_browser". "phone_verification" pratikte hesabın yandığını gösterir.
    lastChallenge: { type: String, default: "" }
  },
  { timestamps: true }
);

googleAuthAccountSchema.set("toJSON", {
  transform: (doc, ret) => {
    ret.id = ret._id;
    ret.hasPassword = Boolean(ret.password);
    ret.hasTwoFaSecret = Boolean(ret.twoFaSecret);
    ret.hasRecoveryPassword = Boolean(ret.recoveryPassword);
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("GoogleAuthAccount", googleAuthAccountSchema);
