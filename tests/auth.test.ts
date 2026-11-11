import { describe, expect, it } from "vite-plus/test";
import { authenticateToken, authError } from "../src/api/auth.js";

const secret = "mV2JB7MvBg0fAhdpk2EbNsQ1ifZ6QZlUzAf9RdH2tny";

function request(token?: string) {
  return new Request("https://example.test/api/bookmarks/", {
    headers: token === undefined ? {} : { Authorization: token },
  });
}

describe("linkding token authentication", () => {
  it("fails closed without a correctly configured secret", async () => {
    expect(await authenticateToken(request(), undefined)).toBe("unavailable");
    expect(await authenticateToken(request(), "short-secret")).toBe("unavailable");
    expect(authError("unavailable").status).toBe(503);
  });

  it("accepts only the exact Token authorization scheme", async () => {
    expect(await authenticateToken(request("Token " + secret), secret)).toBe("ok");
    expect(await authenticateToken(request("Bearer " + secret), secret)).toBe("invalid");
    expect(await authenticateToken(request("token " + secret), secret)).toBe("invalid");
    expect(await authenticateToken(request("Token " + secret + "x"), secret)).toBe("invalid");
    expect(await authenticateToken(request(), secret)).toBe("invalid");
  });

  it("returns linkding-style 401 and never includes the secret", () => {
    const response = authError("invalid");
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Token");
  });
});
