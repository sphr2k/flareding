import { describe, expect, it } from "vite-plus/test";
import { handleSession, hasBrowserSession, isSameOriginMutation } from "../src/api/session.js";

const secret = "flareding-session-protocol-random-secret-of-at-least-32-bytes";

function post(token: string, origin = "https://bookmark.example") {
  return new Request("https://bookmark.example/api/session/", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

describe("short-lived HttpOnly UI session", () => {
  it("validates a token and creates secure host-only session cookie", async () => {
    const response = await handleSession(post(secret), secret);
    expect(response.status).toBe(200);
    const cookie = response.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api");
    expect(cookie).not.toContain(secret);
    const request = new Request("https://bookmark.example/api/bookmarks/", {
      headers: { Cookie: cookie.split(";")[0] },
    });
    expect(await hasBrowserSession(request, secret)).toBe(true);
    expect(await hasBrowserSession(request, secret + "different")).toBe(false);
  });

  it("rejects bad token, cross-origin POST and tampered session", async () => {
    expect((await handleSession(post("bad"), secret)).status).toBe(401);
    expect((await handleSession(post(secret, "https://malicious.example"), secret)).status).toBe(
      403,
    );
    const request = new Request("https://bookmark.example/api/bookmarks/", {
      headers: { Cookie: "flareding_session=1750000000.malicious" },
    });
    expect(await hasBrowserSession(request, secret)).toBe(false);
    expect(isSameOriginMutation(post(secret, "https://malicious.example"))).toBe(false);
  });

  it("does not require an origin for GET, but does for cookie-authenticated writes", () => {
    const get = new Request("https://bookmark.example/api/bookmarks/");
    expect(isSameOriginMutation(get)).toBe(true);
    const patch = new Request("https://bookmark.example/api/bookmarks/1/", { method: "PATCH" });
    expect(isSameOriginMutation(patch)).toBe(false);
  });
});
