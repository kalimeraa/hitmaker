const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const JSZip = require("jszip");

function loadUploadUi(files, requests) {
  const cookieSets = [{ name: "accounts/account.json", cookies: [{ name: "SID", value: "synthetic", domain: ".google.com", path: "/" }] }];
  const element = new Proxy({
    0: { files },
    length: 1,
    find(selector) { return selector.includes(":checked") ? { val: () => "file" } : element; },
    val() { return "google.com"; },
    text() { return ""; }
  }, { get: (target, key) => key in target ? target[key] : () => element });
  const $ = () => element;
  $.getJSON = () => new Promise(() => {});
  $.ajax = async (request) => {
    requests.push({ url: request.url, payload: JSON.parse(request.data) });
    return { cookieSets };
  };
  const context = vm.createContext({
    $, document: { getElementById: () => null }, window: { addEventListener() {} },
    bootstrap: { Modal: class {} }, EventSource: class { addEventListener() {} },
    FileReader: class {
      readAsText(file) { this.result = file.buffer.toString("utf8"); this.onload(); }
      readAsDataURL(file) { this.result = `data:application/zip;base64,${file.buffer.toString("base64")}`; this.onload(); }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8"), context);
  return { context, cookieSets };
}

for (const scope of ["create", "edit"]) {
  test(`${scope} task cookie upload preserves ZIP bytes and uses separate cookie sets`, async () => {
    const zip = new JSZip().file("accounts/account.json", '[{"name":"SID","value":"synthetic"}]');
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const requests = [];
    const { context, cookieSets } = loadUploadUi([{ name: "accounts.zip", buffer, size: buffer.length }], requests);
    const result = await context.readCookieInput(scope);
    assert.deepEqual(JSON.parse(JSON.stringify(result.cookieSets)), cookieSets);
    assert.equal(requests[0].url, "/api/cookies/parse");
    assert.equal(requests[0].payload.files[0].base64, buffer.toString("base64"));
  });
}

test("cookie pool upload parses ZIP before saving normalized sets", async () => {
  const buffer = await new JSZip().file("account.txt", "SID=synthetic").generateAsync({ type: "nodebuffer" });
  const requests = [];
  const { context, cookieSets } = loadUploadUi([{ name: "accounts.zip", buffer, size: buffer.length }], requests);
  await context.importCookiePoolFiles();
  assert.equal(requests[0].url, "/api/cookies/parse");
  assert.equal(requests[1].url, "/api/cookies");
  assert.deepEqual(requests[1].payload.cookieSets, cookieSets);
});
