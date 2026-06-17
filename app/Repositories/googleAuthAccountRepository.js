const GoogleAuthAccount = require("../Models/GoogleAuthAccount");

class GoogleAuthAccountRepository {
  findRecent(limit = 200) {
    return GoogleAuthAccount.find().sort({ createdAt: -1 }).limit(limit);
  }

  findById(id) {
    return GoogleAuthAccount.findById(id);
  }

  create(payload) {
    return GoogleAuthAccount.create(payload);
  }

  update(id, payload) {
    return GoogleAuthAccount.findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true });
  }

  upsertByEmail(email, payload) {
    return GoogleAuthAccount.findOneAndUpdate(
      { email },
      { $set: payload },
      { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
    );
  }

  markCookieGenerated(id, payload) {
    return GoogleAuthAccount.findByIdAndUpdate(id, {
      $set: {
        lastCookiePoolId: payload.cookiePoolId,
        lastCookieFilePath: payload.cookieFilePath || "",
        lastCookieFileName: payload.cookieFileName || "",
        lastCookieGeneratedAt: new Date(),
        lastLoginUrl: payload.loginUrl || "",
        lastError: ""
      }
    }, { new: true });
  }

  markCookieFile(id, payload) {
    return GoogleAuthAccount.findByIdAndUpdate(id, {
      $set: {
        lastCookieFilePath: payload.cookieFilePath || "",
        lastCookieFileName: payload.cookieFileName || ""
      }
    }, { new: true });
  }

  markLoginFailed(id, error, loginUrl = "") {
    return GoogleAuthAccount.findByIdAndUpdate(id, {
      $set: {
        lastError: error,
        lastLoginUrl: loginUrl
      }
    }, { new: true });
  }

  deleteById(id) {
    return GoogleAuthAccount.findByIdAndDelete(id);
  }

  deleteAll() {
    return GoogleAuthAccount.deleteMany({});
  }
}

module.exports = new GoogleAuthAccountRepository();
