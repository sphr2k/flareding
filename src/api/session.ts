import { z } from "zod";
import { authenticateToken, authError } from "./auth.js";

const SESSION_COOKIE = "flareding_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function encodeSignature(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sign(secret: string, expirationSeconds: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeSignature(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`flareding-session-v1:${expirationSeconds}`),
    ),
  );
}

function equalsConstantTime(a: string, b: string): boolean {
  // Both HMAC-SHA256 signatures are 43 base64url characters.
  if (a.length !== 43 || b.length !== 43) return false;
  let different = 0;
  for (let i = 0; i < 43; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

function extractCookie(request: Request): string | undefined {
  return request.headers
    .get("Cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

export async function hasBrowserSession(
  request: Request,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const cookie = extractCookie(request);
  if (!cookie || cookie.length > 120) return false;
  const [expiration, signature, ...rest] = cookie.split(".");
  if (rest.length || !expiration || !signature || !/^\d+$/.test(expiration)) return false;
  const timestamp = Number(expiration);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp <= now || timestamp > now + MAX_AGE_SECONDS)
    return false;
  return equalsConstantTime(signature, await sign(secret, timestamp));
}

export function isSameOriginMutation(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

export async function handleSession(
  request: Request,
  configuredSecret: string | undefined,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (!configuredSecret || configuredSecret.length < 32) return authError("unavailable");

  if (request.method === "GET") {
    return Response.json(
      { authenticated: await hasBrowserSession(request, configuredSecret) },
      { headers },
    );
  }
  if (request.method === "DELETE") {
    if (!isSameOriginMutation(request))
      return Response.json({ detail: "Forbidden." }, { status: 403, headers });
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        "Set-Cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/api; HttpOnly; Secure; SameSite=Strict`,
      },
    });
  }
  if (request.method !== "POST")
    return Response.json({ detail: "Method not allowed." }, { status: 405, headers });
  if (!isSameOriginMutation(request))
    return Response.json({ detail: "Forbidden." }, { status: 403, headers });

  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > 4096)
    return Response.json({ detail: "Request too large." }, { status: 413, headers });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ detail: "Invalid JSON." }, { status: 400, headers });
  }
  const parsed = z
    .object({ token: z.string().min(1).max(512) })
    .strict()
    .safeParse(payload);
  if (!parsed.success)
    return Response.json({ detail: "Invalid token payload." }, { status: 400, headers });

  const bearerRequest = new Request(request.url, {
    headers: { Authorization: `Token ${parsed.data.token}` },
  });
  if ((await authenticateToken(bearerRequest, configuredSecret)) !== "ok")
    return authError("invalid");

  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  return Response.json(
    { authenticated: true },
    {
      headers: {
        ...headers,
        "Set-Cookie": `${SESSION_COOKIE}=${expires}.${await sign(configuredSecret, expires)}; Max-Age=${MAX_AGE_SECONDS}; Path=/api; HttpOnly; Secure; SameSite=Strict`,
      },
    },
  );
}
