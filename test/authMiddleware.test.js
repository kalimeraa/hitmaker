const assert = require("node:assert/strict");
const test = require("node:test");
const { isPublicApiRoute, requireAuth } = require("../app/Http/Middleware/authMiddleware");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    redirectUrl: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirect(url) {
      this.redirectUrl = url;
      return this;
    }
  };
}

test("MR login public POST endpoints bypass panel authentication", () => {
  const routes = [
    "/api/mr-giris/browsers",
    "/api/mr-giris/login",
    "/api/mr-giris/email-code"
  ];

  for (const path of routes) {
    const req = {
      method: "POST",
      originalUrl: path,
      accepts: () => "json",
      headers: {}
    };
    const res = createResponse();
    let nextCalled = false;

    assert.equal(isPublicApiRoute(req), true);
    requireAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.body, null);
  }
});

test("MR login public auth bypass is limited to exact POST routes", () => {
  const protectedRequests = [
    { method: "GET", originalUrl: "/api/mr-giris/browsers" },
    { method: "POST", originalUrl: "/api/mr-giris/ready" },
    { method: "POST", originalUrl: "/api/mr-giris/login/123/email-code" },
    { method: "POST", originalUrl: "/api/tasks" }
  ];

  for (const req of protectedRequests) {
    assert.equal(isPublicApiRoute({ ...req, accepts: () => "json", headers: {} }), false);
  }
});

test("protected API requests still require authentication", () => {
  const req = {
    method: "POST",
    originalUrl: "/api/mr-giris/ready",
    accepts: () => "json",
    headers: {}
  };
  const res = createResponse();
  let nextCalled = false;

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Unauthorized" });
});
