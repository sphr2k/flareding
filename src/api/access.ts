import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "../env.js";
import { issueBrowserSession, isSameOriginMutation } from "./session.js";

export type AccessIdentity = { email: string; subject: string };

const jwksByIssuer = new Map<string, JWTVerifyGetKey>();

/** A partially configured Access login must fail closed, never silently fall back to token UI login. */
export function accessMode(env: Env): boolean {
  return Boolean(
    env.ACCESS_AUD || env.ACCESS_TEAM_DOMAIN || env.ACCESS_ALLOWED_EMAIL || env.SESSION_SECRET,
  );
}

function configured(env: Env): env is Env & {
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_ALLOWED_EMAIL: string;
  SESSION_SECRET: string;
} {
  return Boolean(
    env.ACCESS_AUD &&
    env.ACCESS_TEAM_DOMAIN &&
    env.ACCESS_ALLOWED_EMAIL &&
    env.SESSION_SECRET &&
    env.SESSION_SECRET.length >= 32 &&
    env.SESSION_SECRET !== env.API_TOKEN,
  );
}

export function accessReady(env: Env): boolean {
  return configured(env);
}

/** Validate signature, trusted issuer, specific application audience and user identity. */
export async function verifyAccessIdentity(
  jwt: string,
  env: Env,
  keySource?: JWTVerifyGetKey,
): Promise<AccessIdentity | null> {
  if (!configured(env) || jwt.length > 8192) return null;
  const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  let domain: URL;
  try {
    domain = new URL(issuer);
  } catch {
    return null;
  }
  if (
    domain.protocol !== "https:" ||
    domain.pathname !== "/" ||
    !domain.hostname.endsWith(".cloudflareaccess.com")
  )
    return null;
  let keys = keySource ?? jwksByIssuer.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
    jwksByIssuer.set(issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(jwt, keys, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      clockTolerance: 15,
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (
      !email ||
      email !== env.ACCESS_ALLOWED_EMAIL.trim().toLowerCase() ||
      typeof payload.sub !== "string" ||
      !payload.sub
    )
      return null;
    return { email, subject: payload.sub };
  } catch {
    return null;
  }
}

/**
 * This is NOT an /api/* endpoint: the hostname-scoped Access application
 * protects /auth/* while the public linkding API gets an Access bypass.
 * Origin check plus mandatory verified Access JWT prevents login CSRF/spoofing.
 */
export async function handleAccessSession(
  request: Request,
  env: Env,
  keySource?: JWTVerifyGetKey,
): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.method !== "POST")
    return Response.json({ detail: "Method not allowed." }, { status: 405, headers });
  if (!isSameOriginMutation(request))
    return Response.json({ detail: "Forbidden." }, { status: 403, headers });
  if (!configured(env))
    return Response.json({ detail: "Access login not configured" }, { status: 503, headers });
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  const identity = assertion ? await verifyAccessIdentity(assertion, env, keySource) : null;
  if (!identity)
    return Response.json(
      { detail: "Cloudflare Access authorization required" },
      { status: 401, headers },
    );
  const session = await issueBrowserSession(env.SESSION_SECRET);
  return Response.json(
    { authenticated: true },
    {
      headers: { ...headers, "Set-Cookie": session },
    },
  );
}

// Export only the standard local JWKS helper for test fixtures; the Worker
// always gets a remote Cloudflare-signed keyset on real requests.
export { createLocalJWKSet };
