const { launchBrowserContext } = require("./cloakBrowserClient");
const {
  warmUpSession,
  humanType,
  humanMouseMove,
  humanHoverClick,
  humanScroll,
  clickNext,
  randomDelay,
  delay,
  detectRecaptchaChallenge,
  waitForManualRecaptchaIfNeeded
} = require("./googleAuthLogin");
const { generateUsername } = require("../Domain/gmailSignupIdentity");
const { createPageSnapshotter } = require("./pageSnapshotService");

const SIGNUP_URL = "https://accounts.google.com/signup/v2/webcreateaccount?flowName=GlifWebSignIn&flowEntry=SignUp";
const MANUAL_TIMEOUT_MS = Number(process.env.GMAIL_CREATOR_TIMEOUT_MS || 600000);
const NAV_TIMEOUT_MS = Number(process.env.GMAIL_CREATOR_NAV_TIMEOUT_MS || 120000);
const MAX_SIGNUP_STEPS = Number(process.env.GMAIL_CREATOR_MAX_STEPS || 24);

function isSignupSuccessUrl(url = "") {
  return /myaccount\.google\.com|mail\.google\.com|accounts\.google\.com\/AccountChooser|accounts\.google\.com\/signin\/v2\/challenge\/done/i.test(url);
}

async function visibleFirst(page, selectors, timeout = 8000) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: Math.min(timeout, 3000) }).catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function clickNextButton(page) {
  const clicked = await clickNext(page);
  if (clicked.clicked) return true;

  const labels = ["Next", "İleri", "Sonraki", "I agree", "Kabul ediyorum", "Kabul Et"];
  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(label, "i") }).first();
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      await humanHoverClick(page, button);
      return true;
    }
  }
  return false;
}

async function waitForManualProgress(page, onEvent, { hint, detectDone, timeoutMs = MANUAL_TIMEOUT_MS }) {
  await onEvent("gmail_creator_manual_wait", { hint, url: page.url(), timeoutMs });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) {
      return { success: false, error: "browser_closed", failureReason: "browser_closed", url: "" };
    }
    if (await detectDone()) {
      await onEvent("gmail_creator_manual_completed", { hint, url: page.url() });
      return { success: true };
    }
    await delay(2000);
  }
  return {
    success: false,
    error: "gmail_creator_manual_timeout",
    failureReason: "manual_timeout",
    url: page.url()
  };
}

async function detectPhoneStep(page) {
  const url = page.url();
  if (/\/signin\/challenge\/iap|\/phone|\/verifyphone/i.test(url)) return true;
  if (await detectBirthdayStep(page)) return false;

  const phone = page.locator("input#phoneNumberId, input[name='phoneNumber'], input[autocomplete='tel'], input[aria-label*='phone' i], input[aria-label*='telefon' i]").first();
  if (await phone.isVisible({ timeout: 1200 }).catch(() => false)) return true;

  const phoneText = page.getByText(/enter a phone number|get a verification code|telefon numarası girin|doğrulama kodu/i).first();
  return phoneText.isVisible({ timeout: 1200 }).catch(() => false);
}

async function detectSmsCodeStep(page) {
  const code = page.locator('input[name="code"], input#code, input[autocomplete="one-time-code"]').first();
  return code.isVisible({ timeout: 1200 }).catch(() => false);
}

async function detectNameStep(page) {
  const first = await visibleFirst(page, ["input[name='firstName']", "input#firstName"], 1500);
  return Boolean(first);
}

async function detectBirthdayStep(page) {
  if (/\/signup\/birthdaygender/i.test(page.url())) return true;

  const visible = await visibleFirst(page, [
    "input[name='day']",
    "input#day",
    "input[aria-label*='Day']",
    "input[aria-label*='Gün']"
  ], 1500);
  if (visible) return true;

  const heading = page.getByText(/basic information|enter your birthday and gender|doğum tarihinizi ve cinsiyetinizi/i).first();
  return heading.isVisible({ timeout: 1200 }).catch(() => false);
}

async function detectUsernameStep(page) {
  if (/\/signup\/username/i.test(page.url())) return true;

  const customRadio = page.locator("input[name='usernameRadio'][value='custom']").first();
  if (await customRadio.isVisible({ timeout: 1200 }).catch(() => false)) return true;

  const username = await visibleFirst(page, [
    "input[name='Username']",
    "input[name='username']",
    "input[aria-label*='Gmail']",
    "input[type='email']"
  ], 1500);
  return Boolean(username);
}

async function detectPasswordStep(page) {
  const password = await visibleFirst(page, ["input[name='Passwd']", "input[type='password']"], 1500);
  return Boolean(password);
}

async function detectCurrentSignupStep(page) {
  if (isSignupSuccessUrl(page.url())) return "success";
  if (await detectRecaptchaChallenge(page)) return "recaptcha";
  if (await detectSmsCodeStep(page)) return "sms";
  if (await detectPhoneStep(page)) return "phone";
  if (await detectBirthdayStep(page)) return "birthday";
  if (await detectNameStep(page)) return "name";
  if (await detectUsernameStep(page)) return "username";
  if (await detectPasswordStep(page)) return "password";
  return "unknown";
}

async function selectByNativeOrKeyboard(page, nativeSelector, labelPattern, optionIndex) {
  const native = page.locator(nativeSelector).first();
  if (await native.isVisible({ timeout: 1200 }).catch(() => false)) {
    await native.selectOption(String(optionIndex)).catch(async () => {
      await native.selectOption({ index: optionIndex }).catch(() => {});
    });
    return true;
  }

  const combo = page.getByRole("combobox", { name: labelPattern }).first();
  if (!(await combo.isVisible({ timeout: 1200 }).catch(() => false))) return false;

  await humanHoverClick(page, combo);
  await randomDelay(150, 350);
  const listboxId = await combo.getAttribute("aria-controls").catch(() => "");
  const scopedOption = listboxId
    ? page.locator(`#${listboxId} [role='option'][data-value='${optionIndex}']`).first()
    : null;
  if (scopedOption && await scopedOption.isVisible({ timeout: 1500 }).catch(() => false)) {
    await humanHoverClick(page, scopedOption);
    return true;
  }

  const option = page.locator(`[role='option'][data-value='${optionIndex}']`).first();
  if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
    await humanHoverClick(page, option);
    return true;
  }

  for (let index = 0; index < optionIndex; index += 1) {
    await page.keyboard.press("ArrowDown");
    await randomDelay(30, 90);
  }
  await page.keyboard.press("Enter");
  return true;
}

async function selectMaterialCombobox(page, labelText, value) {
  const label = page.getByText(new RegExp(`^${labelText}$`, "i")).first();
  const labelId = await label.getAttribute("id").catch(() => "");
  const combo = labelId
    ? page.locator(`[role='combobox'][aria-labelledby~='${labelId}']`).first()
    : page.locator("[role='combobox']").filter({ hasText: new RegExp(`^${labelText}$`, "i") }).first();

  if (!(await combo.isVisible({ timeout: 2000 }).catch(() => false))) return false;

  await combo.click({ timeout: 5000 });
  await randomDelay(250, 500);

  const option = page
    .locator(`ul[role='listbox'][aria-label='${labelText}'] [role='option'][data-value='${value}']`)
    .first();

  if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
    await option.click({ timeout: 5000 });
    await randomDelay(250, 500);
    return true;
  }

  const forceOption = page
    .locator(`ul[role='listbox'][aria-label='${labelText}'] [role='option'][data-value='${value}']`)
    .first();
  if (await forceOption.count().catch(() => 0)) {
    await forceOption.click({ timeout: 5000, force: true });
    await randomDelay(250, 500);
    return true;
  }

  await combo.focus().catch(() => {});
  await page.keyboard.press("Home").catch(() => {});
  for (let index = 0; index < Number(value); index += 1) {
    await page.keyboard.press("ArrowDown");
    await randomDelay(40, 100);
  }
  await page.keyboard.press("Enter");
  await randomDelay(250, 500);
  return true;
}

async function clearAndHumanType(locator, value) {
  await locator.fill("").catch(async () => {
    await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await locator.press("Backspace").catch(() => {});
  });
  await humanType(locator, String(value));
}

async function clearAndFill(locator, value) {
  await locator.fill("", { timeout: 5000 }).catch(async () => {
    await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await locator.press("Backspace").catch(() => {});
  });
  await locator.fill(String(value), { timeout: 5000 });
}

async function fillNameStep(page, identity, onEvent) {
  const first = await visibleFirst(page, ["input[name='firstName']", "input#firstName"]);
  const last = await visibleFirst(page, ["input[name='lastName']", "input#lastName"]);
  if (!first || !last) return false;

  await onEvent("gmail_creator_name_step_started", {});
  await humanHoverClick(page, first);
  await humanType(first, identity.firstName);
  await randomDelay(300, 700);
  await humanHoverClick(page, last);
  await humanType(last, identity.lastName);
  await randomDelay(400, 900);
  await clickNextButton(page);
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await randomDelay(1200, 2200);
  await onEvent("gmail_creator_name_step_completed", { url: page.url() });
  return true;
}

async function fillBirthdayStep(page, identity, onEvent) {
  const dayInput = await visibleFirst(page, [
    "input[name='day']",
    "input#day",
    "input[aria-label*='Day']",
    "input[aria-label*='Gün']"
  ]);
  if (!dayInput) return false;

  await onEvent("gmail_creator_birthday_step_started", {});
  const { day, month, year } = identity.birthday;

  const monthSelected = await selectMaterialCombobox(page, "Month", month);
  if (!monthSelected) {
    await selectByNativeOrKeyboard(page, "select#month, select[name='month']", /month|ay/i, month);
  }
  await randomDelay(200, 500);

  await humanHoverClick(page, dayInput);
  await clearAndFill(dayInput, day);
  await randomDelay(200, 500);

  const yearInput = page.locator("input[name='year'], input#year, input[aria-label*='Year'], input[aria-label*='Yıl']").first();
  if (await yearInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanHoverClick(page, yearInput);
    await clearAndFill(yearInput, year);
  }

  const genderSelected = await selectMaterialCombobox(page, "Gender", 1);
  if (!genderSelected) {
    await selectByNativeOrKeyboard(page, "select#gender, select[name='gender']", /gender|cinsiyet/i, 1);
  }

  await randomDelay(500, 1100);
  await clickNextButton(page);
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await randomDelay(1200, 2200);
  await onEvent("gmail_creator_birthday_step_completed", { url: page.url() });
  return true;
}

async function fillUsernameStep(page, identity, onEvent, usernameAttempt = 0) {
  const customRadio = page.locator("input[name='usernameRadio'][value='custom']").first();
  if (await customRadio.isVisible({ timeout: 1200 }).catch(() => false)) {
    await onEvent("gmail_creator_username_custom_option_started", {});
    await customRadio.click({ timeout: 5000, force: true }).catch(async () => {
      const customText = page.getByText(/create your own gmail address|kendi gmail adresinizi oluşturun/i).first();
      if (await customText.isVisible({ timeout: 1500 }).catch(() => false)) {
        await humanHoverClick(page, customText);
      }
    });
    await randomDelay(500, 1000);
  }

  const usernameInput = await visibleFirst(page, [
    "input[name='Username']",
    "input[name='username']",
    "input[aria-label='Create a Gmail address']",
    "input[aria-label*='Gmail address']",
    "input[aria-label*='Gmail']",
    "input[type='email']"
  ]);
  if (!usernameInput) return { filled: false, username: identity.username };

  const username = usernameAttempt > 0
    ? generateUsername({ firstName: identity.firstName, lastName: identity.lastName, attempt: usernameAttempt })
    : identity.username;

  await onEvent("gmail_creator_username_step_started", { username, attempt: usernameAttempt + 1 });
  await humanHoverClick(page, usernameInput);
  await usernameInput.fill("").catch(() => {});
  await humanType(usernameInput, username);
  await randomDelay(500, 1200);
  await clickNextButton(page);
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await randomDelay(1500, 2800);

  const warningText = await page.evaluate(() => document.body.innerText).catch(() => "");
  const taken = /that username is taken|bu kullanıcı adı alınmış|not available|kullanılamıyor/i.test(warningText);
  if (taken && usernameAttempt < 4) {
    await onEvent("gmail_creator_username_taken", { username, attempt: usernameAttempt + 1 });
    return fillUsernameStep(page, identity, onEvent, usernameAttempt + 1);
  }

  await onEvent("gmail_creator_username_step_completed", { username, url: page.url() });
  return { filled: true, username, email: `${username}@gmail.com` };
}

async function fillPasswordStep(page, identity, onEvent) {
  const passwordInput = await visibleFirst(page, ["input[name='Passwd']", "input[type='password']"]);
  const confirmInput = page.locator("input[name='PasswdAgain']").first();
  if (!passwordInput) return false;

  await onEvent("gmail_creator_password_step_started", {});
  await humanHoverClick(page, passwordInput);
  await clearAndFill(passwordInput, identity.password);
  await randomDelay(400, 900);

  if (await confirmInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanHoverClick(page, confirmInput);
    await clearAndFill(confirmInput, identity.password);
  }

  await randomDelay(500, 1100);
  await clickNextButton(page);
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await randomDelay(1500, 2800);
  await onEvent("gmail_creator_password_step_completed", { url: page.url() });
  return true;
}

async function handleManualBlockers(page, onEvent) {
  const recaptcha = await detectRecaptchaChallenge(page);
  if (recaptcha) {
    const solved = await waitForManualRecaptchaIfNeeded(page, false, "", "", onEvent, MANUAL_TIMEOUT_MS, "");
    if (!solved.success) return solved;
  }

  if (await detectPhoneStep(page)) {
    await onEvent("gmail_creator_phone_manual_required", { url: page.url() });
    const phoneDone = await waitForManualProgress(page, onEvent, {
      hint: "Telefon numarası ve SMS kodunu tarayıcıda elle girin, sonra devam edin.",
      detectDone: async () => {
        if (isSignupSuccessUrl(page.url())) return true;
        if (!(await detectPhoneStep(page)) && !(await detectSmsCodeStep(page))) return true;
        return false;
      }
    });
    if (!phoneDone.success) return phoneDone;
  }

  if (await detectSmsCodeStep(page)) {
    await onEvent("gmail_creator_sms_manual_required", { url: page.url() });
    const smsDone = await waitForManualProgress(page, onEvent, {
      hint: "SMS doğrulama kodunu tarayıcıda girin.",
      detectDone: async () => isSignupSuccessUrl(page.url()) || !(await detectSmsCodeStep(page))
    });
    if (!smsDone.success) return smsDone;
  }

  return { success: true };
}

async function waitForManualBirthdayStep(page, onEvent) {
  await onEvent("gmail_creator_birthday_manual_required", { url: page.url() });
  return waitForManualProgress(page, onEvent, {
    hint: "Doğum tarihi ve cinsiyeti tarayıcıda elle seçip Next'e basın.",
    detectDone: async () => !(await detectBirthdayStep(page))
  });
}

async function runUsernameStep(page, identity, onEvent) {
  const usernameResult = await fillUsernameStep(page, identity, onEvent);
  if (!usernameResult.filled) {
    return { success: false, error: "gmail_creator_username_step_missing", failureReason: "signup_step", url: page.url() };
  }

  identity.username = usernameResult.username;
  identity.email = usernameResult.email;
  return { success: true };
}

async function runSignupWizard(page, identity, onEvent, snapshotPage = async () => {}) {
  for (let stepIndex = 1; stepIndex <= MAX_SIGNUP_STEPS; stepIndex += 1) {
    const step = await detectCurrentSignupStep(page);
    await onEvent("gmail_creator_step_detected", { step, stepIndex, url: page.url() });
    await snapshotPage(page, `before_${String(stepIndex).padStart(2, "0")}_${step}`, { step, stepIndex });

    if (step === "success") return { success: true, url: page.url() };

    if (step === "recaptcha" || step === "phone" || step === "sms") {
      const manual = await handleManualBlockers(page, onEvent);
      if (!manual.success) return manual;
      await snapshotPage(page, `after_${String(stepIndex).padStart(2, "0")}_${step}`, { step, stepIndex });
      continue;
    }

    if (step === "name") {
      if (!(await fillNameStep(page, identity, onEvent))) {
        return { success: false, error: "gmail_creator_name_step_missing", failureReason: "signup_step", url: page.url() };
      }
      await snapshotPage(page, `after_${String(stepIndex).padStart(2, "0")}_name`, { step, stepIndex });
      continue;
    }

    if (step === "birthday") {
      if (!(await fillBirthdayStep(page, identity, onEvent))) {
        const birthdayDone = await waitForManualBirthdayStep(page, onEvent);
        if (!birthdayDone.success) return birthdayDone;
      }
      await snapshotPage(page, `after_${String(stepIndex).padStart(2, "0")}_birthday`, { step, stepIndex });
      continue;
    }

    if (step === "username") {
      const usernameDone = await runUsernameStep(page, identity, onEvent);
      if (!usernameDone.success) return usernameDone;
      await snapshotPage(page, `after_${String(stepIndex).padStart(2, "0")}_username`, { step, stepIndex });
      continue;
    }

    if (step === "password") {
      if (!(await fillPasswordStep(page, identity, onEvent))) {
        return { success: false, error: "gmail_creator_password_step_missing", failureReason: "signup_step", url: page.url() };
      }
      await snapshotPage(page, `after_${String(stepIndex).padStart(2, "0")}_password`, { step, stepIndex });
      continue;
    }

    await onEvent("gmail_creator_unknown_step_manual_required", { stepIndex, url: page.url() });
    const unknownDone = await waitForManualProgress(page, onEvent, {
      hint: "Bilinmeyen Google adımı çıktı. Ekrandaki alanları tarayıcıda tamamlayıp devam edin; HTML htmls klasörüne kaydedildi.",
      detectDone: async () => {
        const nextStep = await detectCurrentSignupStep(page);
        return nextStep !== "unknown";
      }
    });
    if (!unknownDone.success) return unknownDone;
  }

  return {
    success: false,
    error: "gmail_creator_max_steps_reached",
    failureReason: "signup_step",
    url: page.url()
  };
}

async function createGmailAccount({
  identity,
  proxyUrl = "",
  deviceMode = "desktop",
  profileKey = "",
  onEvent = async () => {}
}) {
  const context = await launchBrowserContext({
    headless: false,
    deviceMode,
    proxyUrl,
    profileKey
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    await onEvent("gmail_creator_context_started", {
      email: identity.email,
      hasProxy: Boolean(proxyUrl),
      profileKey
    });

    if (process.env.GAUTH_WARMUP !== "0") {
      await warmUpSession(page, onEvent, { captchaApiKey: "", proxyUrl });
    }

    await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await randomDelay(1200, 2400);
    await humanMouseMove(page);
    await humanScroll(page);

    const snapshotPage = createPageSnapshotter({
      prefix: "gmail_creator",
      runKey: profileKey || identity.username,
      onEvent
    });
    await snapshotPage(page, "after_signup_open", { step: "opened" });

    const wizard = await runSignupWizard(page, identity, onEvent, snapshotPage);
    if (!wizard.success) {
      return wizard;
    }

    await page.goto("https://myaccount.google.com/", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => {});
    await randomDelay(1000, 2000);

    await onEvent("gmail_creator_completed", {
      email: identity.email,
      username: identity.username,
      url: page.url()
    });

    return {
      success: true,
      email: identity.email,
      password: identity.password,
      username: identity.username,
      firstName: identity.firstName,
      lastName: identity.lastName,
      birthday: identity.birthday,
      url: page.url()
    };
  } catch (error) {
    await onEvent("gmail_creator_failed", { error: error.message });
    return {
      success: false,
      error: error.message || "gmail_creator_failed",
      failureReason: "automation_error"
    };
  } finally {
    await context.close();
  }
}

module.exports = {
  createGmailAccount,
  SIGNUP_URL,
  MANUAL_TIMEOUT_MS
};
