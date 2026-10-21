const assert = require("node:assert/strict");
const test = require("node:test");
const JSZip = require("jszip");
const { parseCookieFiles } = require("../app/Services/cookieFileImportService");
const { validateCreateTaskPayload } = require("../app/Validators/taskValidator");
const { validateCookiePoolImportPayload } = require("../app/Validators/cookiePoolValidator");

function upload(name, content) {
  return { name, base64: Buffer.from(content).toString("base64") };
}

async function archive(entries) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return upload("accounts.zip", await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

test("ZIP imports nested accounts as isolated sets usable by task and pool validators", async () => {
  const file = await archive({
    "account-b/cookies.json": JSON.stringify([{ name: "SID", value: "account-b", domain: ".google.com" }]),
    "account-a/cookies.txt": ".google.com\tTRUE\t/\tTRUE\t0\tSID\taccount-a",
    "account-c/session.cookies": "SID=account-c",
    "__MACOSX/._cookies.json": "metadata",
    "preview.png": "ignored"
  });
  const result = await parseCookieFiles({ files: [file], targetAddress: "example.com" });
  assert.deepEqual(result.cookieSets.map((set) => [set.name, set.cookies[0].value]), [
    ["account-a/cookies.txt", "account-a"],
    ["account-b/cookies.json", "account-b"],
    ["account-c/session.cookies", "account-c"]
  ]);
  const task = validateCreateTaskPayload({ keywords: "test", targetAddress: "example.com", count: 1, ...result });
  const pool = validateCookiePoolImportPayload(result);
  assert.equal(task.cookieSets.length, 3);
  assert.equal(pool.cookieSets.length, 3);
  assert.equal(task.cookies.length, 0);
});

test("plain cookie files retain the existing formats and target domain", async () => {
  const result = await parseCookieFiles({ targetAddress: "https://example.com/path", files: [
    upload("plain.txt", "session=synthetic"),
    upload("export.json", JSON.stringify({ cookies: [{ name: "SID", value: "json", domain: ".google.com" }] }))
  ] });
  assert.equal(result.cookieSets[0].cookies[0].domain, "example.com");
  assert.equal(result.cookieSets[1].cookies[0].value, "json");
});

test("malformed or empty archives report validation errors", async () => {
  for (const file of [upload("broken.zip", "not a zip"), await archive({}), await archive({ "image.png": "image" })]) {
    await assert.rejects(parseCookieFiles({ files: [file] }), (error) => error.statusCode === 400);
  }
});

test("invalid cookie files reject the whole import without echoing cookie contents", async () => {
  const secret = "synthetic-secret-that-must-not-appear";
  const file = await archive({ "valid.txt": "SID=valid", "broken.json": `{${secret}` });
  await assert.rejects(parseCookieFiles({ files: [file] }), (error) => error.statusCode === 400 && !error.message.includes(secret));
});

test("oversized expanded files and too many account sets are rejected", async () => {
  const bomb = await archive({ "large.txt": `SID=${"x".repeat(1024 * 1024)}` });
  await assert.rejects(parseCookieFiles({ files: [bomb] }), (error) => error.statusCode === 400);
  const tooMany = await archive(Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`${index}.txt`, "SID=synthetic"])));
  await assert.rejects(parseCookieFiles({ files: [tooMany] }), (error) => error.statusCode === 400);
});

test("request rejects missing files, invalid base64, unsupported files and excessive input size", async () => {
  const payloads = [
    { files: [] },
    { files: [{ name: "a.zip", base64: "!invalid!" }] },
    { files: [upload("a.exe", "SID=value")] },
    { files: [upload("large.zip", Buffer.alloc(10 * 1024 * 1024 + 1))] }
  ];
  for (const payload of payloads) await assert.rejects(parseCookieFiles(payload), (error) => error.statusCode === 400);
});

test("ZIP entry count and total expanded bytes are bounded", async () => {
  const entries = await archive(Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`${index}.png`, "x"])));
  await assert.rejects(parseCookieFiles({ files: [entries] }), (error) => error.statusCode === 400);
  const expanded = await archive(Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`${index}.txt`, `SID=${"x".repeat(1024 * 1024 - 5)}`])));
  await assert.rejects(parseCookieFiles({ files: [expanded] }), (error) => error.statusCode === 400);
});
