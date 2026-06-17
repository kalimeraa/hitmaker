// Captcha hunt: tries accounts (from /tmp/accounts.json) one by one with a VISIBLE browser until
// one triggers Google's reCAPTCHA, then lets 2captcha solve it live and stops so you can watch.
// Run: CAPTCHA_API_KEY=... CAPTCHA_DEBUG=1 node htmls/captcha-hunt.js
const fs = require("fs");
const { generateGoogleAuthCookies } = require("../app/Automation/googleAuthLogin");

const accounts = JSON.parse(fs.readFileSync(process.env.ACCOUNTS_FILE || "/tmp/accounts.json", "utf8"));
const captchaApiKey = process.env.CAPTCHA_API_KEY || "";
const proxyUrl = process.env.GAUTH_PROXY || "";

const started = Date.now();
const ts = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`;

(async () => {
  for (const acc of accounts) {
    console.log(`\n==== TRYING ${acc.email} ====`);
    let captchaSeen = false;
    let captchaSolved = false;

    const result = await generateGoogleAuthCookies({
      email: acc.email,
      password: acc.password,
      twoFaSecret: acc.twoFa,
      headless: false,
      deviceMode: "desktop",
      proxyUrl,
      captchaApiKey,
      onEvent: async (event, meta = {}) => {
        console.log(`[${ts()}] ${acc.email} ${event} ${JSON.stringify(meta)}`);
        if (event === "google_auth_recaptcha_required") captchaSeen = true;
        if (event === "google_auth_captcha_solved") captchaSolved = true;
      }
    });

    console.log(`[${ts()}] ${acc.email} RESULT success=${result.success} captchaSeen=${captchaSeen} captchaSolved=${captchaSolved} err=${result.error || ""}`);

    if (captchaSeen) {
      console.log(`\n>>> CAPTCHA APPEARED on ${acc.email}. solvedToken=${captchaSolved}, recaptchaPassed=${result.failureReason !== "recaptcha_challenge"}, loginSuccess=${result.success}. STOPPING for observation.`);
      process.exit(0);
    }
    console.log(`>>> no captcha on ${acc.email}, moving on...`);
  }
  console.log("\n>>> No captcha appeared on any account in the list.");
  process.exit(0);
})().catch((error) => {
  console.error("FATAL", error.message);
  process.exit(1);
});
