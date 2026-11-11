/** The linkding wire API uses "Authorization: Token <value>". */
const encoder = new TextEncoder();

export async function authenticateToken(
  request: Request,
  configuredSecret: string | undefined,
): Promise<"ok" | "unavailable" | "invalid"> {
  if (!configuredSecret || configuredSecret.length < 32) return "unavailable";
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Token ")) return "invalid";
  const provided = header.slice("Token ".length);
  if (!provided || provided.length > 512) return "invalid";

  // Compare fixed-size digests without early-exit string equality.
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(configuredSecret)),
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
  ]);
  const a = new Uint8Array(expected);
  const b = new Uint8Array(actual);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0 ? "ok" : "invalid";
}

export function authError(result: "unavailable" | "invalid"): Response {
  if (result === "unavailable") {
    return Response.json(
      { detail: "Bookmark API authentication is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { detail: "Invalid token." },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Token realm="flareding"',
      },
    },
  );
}
