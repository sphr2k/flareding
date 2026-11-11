import { describe, expect, it } from "vite-plus/test";
import {
  createLocalJWKSet,
  accessMode,
  accessReady,
  handleAccessSession,
} from "../src/api/access.js";
import { handleSession, hasBrowserSession } from "../src/api/session.js";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { Env } from "../src/env.js";

const baseConfig = {
  ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
  ACCESS_AUD: "flareding-staging-audience",
  ACCESS_ALLOWED_EMAIL: "person@example.org",
  SESSION_SECRET: "long-independent-session-secret-not-the-api-token",
  API_TOKEN: "a-different-long-independent-linkding-token-value",
} as unknown as Env;

const origin = "https://flareding.test";
const post = (header?: string, from = origin) =>
  new Request(origin + "/auth/access/session", {
    method: "POST",
    headers: {
      Origin: from,
      ...(header ? { "Cf-Access-Jwt-Assertion": header } : {}),
    },
  });

describe("Cloudflare Access OIDC browser authentication", () => {
  it("fails closed on partial config or missing JWT and leaves Token API independent", async () => {
    const partial = { API_TOKEN: baseConfig.API_TOKEN, ACCESS_AUD: "some-audience" } as Env;
    expect(accessMode(partial)).toBe(true);
    expect(accessReady(partial)).toBe(false);
    expect((await handleAccessSession(post(), partial)).status).toBe(503);
    expect((await handleAccessSession(post(), baseConfig)).status).toBe(401);
    expect(
      (
        await handleSession(new Request(origin + "/api/session/"), baseConfig.API_TOKEN, {
          accessMode: true,
          sessionSecret: baseConfig.SESSION_SECRET,
        })
      ).status,
    ).toBe(200);
    const oldLogin = new Request(origin + "/api/session/", {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ token: baseConfig.API_TOKEN }),
    });
    expect(
      (
        await handleSession(oldLogin, baseConfig.API_TOKEN, {
          accessMode: true,
          sessionSecret: baseConfig.SESSION_SECRET,
        })
      ).status,
    ).toBe(403);
  });

  it("requires a signed JWT with correct issuer/audience/email, then issues HttpOnly session", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-1", alg: "RS256" };
    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    const makeToken = (email: string, audience: string, issuer = baseConfig.ACCESS_TEAM_DOMAIN!) =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: "RS256", kid: "test-1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject("test-subject")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    const correct = await makeToken("person@example.org", baseConfig.ACCESS_AUD!);
    expect(
      (await handleAccessSession(post(correct, "https://untrusted.example"), baseConfig, jwks))
        .status,
    ).toBe(403);
    for (const token of [
      await makeToken("outsider@example.org", baseConfig.ACCESS_AUD!),
      await makeToken("person@example.org", "wrong-aud"),
      await makeToken(
        "person@example.org",
        baseConfig.ACCESS_AUD!,
        "https://wrong.cloudflareaccess.com",
      ),
    ]) {
      expect((await handleAccessSession(post(token), baseConfig, jwks)).status).toBe(401);
    }
    const authorized = await handleAccessSession(post(correct), baseConfig, jwks);
    expect(authorized.status).toBe(200);
    const cookie = authorized.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain(baseConfig.API_TOKEN!);
    const apiRequest = new Request(origin + "/api/bookmarks/", {
      headers: { Cookie: cookie.split(";")[0] },
    });
    expect(await hasBrowserSession(apiRequest, baseConfig.SESSION_SECRET)).toBe(true);
    expect(await hasBrowserSession(apiRequest, baseConfig.API_TOKEN)).toBe(false);
  });
});
