// Same-origin policy for state-changing requests: no CORS headers are ever sent, and a POST whose
// Origin header names another host is refused (cookies are SameSite=Lax, this is the second layer).

export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, server-side) send no Origin
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const own = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return host === own;
}
