import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "../env.js";

const jwksByIssuer = new Map<string, JWTVerifyGetKey>();

/**
 * Static Assets use an internal router Worker, which does not forward ctx.access.
 * Independently verify a signed Access application JWT; untrusted HTTP headers
 * (including CF-Access-Client-Id and CF-Access-Jwt-Assertion) are never identities.
 */
export async function authorizeMcp(
  request: Request,
  env: Pick<Env, "MCP_ACCESS_AUD" | "MCP_ACCESS_ISSUER">,
  keysOverride?: JWTVerifyGetKey,
): Promise<Response | null> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  const audience = env.MCP_ACCESS_AUD;
  const issuer = env.MCP_ACCESS_ISSUER?.replace(/\/$/, "");
  if (!audience || !issuer) {
    return Response.json({ error: "MCP Access unavailable" }, { status: 503, headers });
  }
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return Response.json({ error: "MCP Access unavailable" }, { status: 503, headers });
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname.endsWith(".cloudflareaccess.com")
  ) {
    return Response.json({ error: "MCP Access unavailable" }, { status: 503, headers });
  }
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion || assertion.length > 8192) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  let keys = keysOverride ?? jwksByIssuer.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    jwksByIssuer.set(issuer, keys);
  }
  try {
    await jwtVerify(assertion, keys, {
      issuer,
      audience,
      algorithms: ["RS256"],
      clockTolerance: 15,
    });
    return null;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
}
