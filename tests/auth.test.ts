import assert from "node:assert/strict";
import test from "node:test";
import { dashboardKeyConfigured, isAuthorized, unauthorized } from "../lib/auth";

function useKey(value: string | undefined, run: () => void) {
  const original = process.env.DASHBOARD_KEY;
  try {
    if (value === undefined) delete process.env.DASHBOARD_KEY;
    else process.env.DASHBOARD_KEY = value;
    run();
  } finally {
    if (original === undefined) delete process.env.DASHBOARD_KEY;
    else process.env.DASHBOARD_KEY = original;
  }
}

test("missing or blank DASHBOARD_KEY fails closed instead of exposing contact records", () => {
  for (const missing of [undefined, "", "   "]) {
    useKey(missing, () => {
      assert.equal(dashboardKeyConfigured(), false);
      assert.equal(isAuthorized(new Request("https://prospect-os.example/api/prospects")), false);
      assert.equal(unauthorized().status, 503);
    });
  }
});

test("only exact configured dashboard key grants access", () => {
  useKey("private-test-key", () => {
    const request = (key?: string) => new Request("https://prospect-os.example/api/prospects", {
      headers: key ? { "x-dashboard-key": key } : {},
    });
    assert.equal(dashboardKeyConfigured(), true);
    assert.equal(isAuthorized(request("private-test-key")), true);
    assert.equal(isAuthorized(request("private-test-keys")), false);
    assert.equal(isAuthorized(request("private-test-kex")), false);
    assert.equal(isAuthorized(request()), false);
    assert.equal(unauthorized().status, 401);
  });
});
