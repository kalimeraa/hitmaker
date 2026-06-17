// Smoke test: full Google Auth cookie generation with VISIBLE browser + full debug logging.
// Credentials come from env (no secrets in the repo). Use a FRESH account — repeated runs on the
// same account trigger Google's "Too many failed attempts" lock.
//
// Run:
//   GAUTH_EMAIL=foo@gmail.com GAUTH_PASSWORD=secret GAUTH_2FA="aaaa bbbb cccc" \
//   CAPTCHA_API_KEY=47332ee88057c323299924da060b8bfd CAPTCHA_DEBUG=1 \
//   node htmls/smoke-google-auth.js
const { generateGoogleAuthCookies } = require("../app/Automation/googleAuthLogin");

const email = process.env.GAUTH_EMAIL;
const password = process.env.GAUTH_PASSWORD;
const twoFaSecret = process.env.GAUTH_2FA || "";
const captchaApiKey = process.env.CAPTCHA_API_KEY || "";
const proxyUrl = process.env.GAUTH_PROXY || "";

if (!email || !password) {
  console.error("Set GAUTH_EMAIL and GAUTH_PASSWORD (and optionally GAUTH_2FA, CAPTCHA_API_KEY).");
  process.exit(2);
}

const started = Date.now();
const ts = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`;

(async () => {
  console.log(`[${ts()}] === SMOKE TEST START === ${email} (headless=false, captcha=${captchaApiKey ? "on" : "off"}, proxy=${proxyUrl ? "on" : "off"})`);
  const result = await generateGoogleAuthCookies({
    email,
    password,
    twoFaSecret,
    headless: false,
    deviceMode: "desktop",
    proxyUrl,
    captchaApiKey,
    onEvent: async (event, meta = {}) => {
      console.log(`[${ts()}] ${event} ${JSON.stringify(meta)}`);
    }
  });

  console.log(`[${ts()}] === RESULT ===`);
  console.log(JSON.stringify({
    success: result.success,
    error: result.error,
    failureReason: result.failureReason,
    url: result.url,
    cookieCount: result.cookies ? result.cookies.length : 0
  }, null, 2));
  process.exit(result.success ? 0 : 1);
})().catch((error) => {
  console.error(`[${ts()}] FATAL:`, error.message);
  process.exit(1);
});
