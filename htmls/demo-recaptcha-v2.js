// Proves the 2captcha integration end-to-end against 2captcha's OWN reCAPTCHA v2 demo
// (https://2captcha.com/demo/recaptcha-v2) — exactly the flow from their docs:
//   find data-sitekey -> send sitekey+pageurl to 2captcha -> put token in g-recaptcha-response
//   -> click Check -> read "Captcha is passed successfully!".
// This demo is NOT risk-scored, so it isolates OUR code from Google's signin anti-abuse layer.
// Run: CAPTCHA_API_KEY=... CAPTCHA_DEBUG=1 node htmls/demo-recaptcha-v2.js
const { launchBrowserContext } = require("../app/Automation/cloakBrowserClient");
const { solveRecaptchaOnPage } = require("../app/Automation/recaptchaSolver");

const captchaApiKey = process.env.CAPTCHA_API_KEY || "";
const started = Date.now();
const ts = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`;

(async () => {
  if (!captchaApiKey) {
    console.error("Set CAPTCHA_API_KEY");
    process.exit(2);
  }

  const context = await launchBrowserContext({ headless: false, deviceMode: "desktop", proxyUrl: "" });
  const page = await context.newPage();
  console.log(`[${ts()}] opening 2captcha reCAPTCHA v2 demo...`);
  await page.goto("https://2captcha.com/demo/recaptcha-v2", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-sitekey]", { timeout: 30000 });

  const solve = await solveRecaptchaOnPage(page, {
    apiKey: captchaApiKey,
    onEvent: async (event, meta = {}) => console.log(`[${ts()}] ${event} ${JSON.stringify(meta)}`)
  });
  console.log(`[${ts()}] solveRecaptchaOnPage -> ${JSON.stringify({ success: solve.success, error: solve.error })}`);

  // Click the demo's "Check" submit button.
  const clicked = await page.getByRole("button", { name: /Check|Kontrol|Submit/i }).first().click({ timeout: 8000 })
    .then(() => true).catch(() => false);
  console.log(`[${ts()}] check button clicked=${clicked}`);
  await page.waitForTimeout(4000);

  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const passed = /Captcha is passed successfully|successfully|başarı/i.test(bodyText);
  console.log(`[${ts()}] === DEMO RESULT: ${passed ? "PASSED ✅" : "not confirmed"} ===`);
  const snippet = (bodyText.match(/.{0,40}(passed|success|başarı).{0,40}/i) || [""])[0].trim();
  if (snippet) console.log(`   page says: "${snippet}"`);

  await page.waitForTimeout(4000);
  await context.close().catch(() => {});
  process.exit(passed ? 0 : 1);
})().catch((error) => {
  console.error(`[${ts()}] FATAL:`, error.message);
  process.exit(1);
});
