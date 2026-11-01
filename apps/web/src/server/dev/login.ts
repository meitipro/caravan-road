// POST /api/dev/login {name}  (also GET ?name=...&next=/play for a one-click link) and /api/dev/logout.
// Answers 404 unless NODE_ENV != production, DEV_LOGIN=1, GAME_MODE=PLAY and the request is local.

import { fail, ok, HTTP_STATUS } from "../errors";
import { isSameOrigin } from "../guards/origin";
import { devLoginAllowed } from "./flags";
import { DEV_COOKIE, getDevSecret, makeDevCookieValue } from "./session";

const NAME = /^[A-Za-z0-9 _-]{1,24}$/;
const NOT_FOUND = () => new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });

function cookieHeader(value: string, maxAge: number): string {
  return `${DEV_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function devLogin(req: Request, env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (!devLoginAllowed(req, env)) return NOT_FOUND();
  let name: string | null = null;
  if (req.method === "POST") {
    if (!isSameOrigin(req)) return Response.json(fail("BAD_REQUEST", "Cross-origin requests are not allowed."), { status: HTTP_STATUS.BAD_REQUEST });
    try {
      const body = (await req.json()) as { name?: unknown };
      name = typeof body.name === "string" ? body.name.trim() : null;
    } catch {
      name = null;
    }
  } else if (req.method === "GET") {
    name = new URL(req.url).searchParams.get("name")?.trim() ?? null;
  } else {
    return NOT_FOUND();
  }
  if (!name || !NAME.test(name)) {
    return Response.json(fail("BAD_REQUEST", "Name must be 1-24 letters, digits, spaces, _ or -."), { status: HTTP_STATUS.BAD_REQUEST });
  }
  const cookie = cookieHeader(makeDevCookieValue(getDevSecret(), name), 30 * 86400);
  if (req.method === "GET") {
    const next = new URL(req.url).searchParams.get("next");
    const target = next && /^\/[A-Za-z0-9/_-]*$/.test(next) ? next : "/play"; // same-site paths only
    return new Response(null, { status: 303, headers: { location: target, "set-cookie": cookie, "cache-control": "no-store" } });
  }
  return Response.json(ok({ name }), { headers: { "set-cookie": cookie, "cache-control": "no-store" } });
}

export async function devLogout(req: Request, env: Record<string, string | undefined> = process.env): Promise<Response> {
  if (!devLoginAllowed(req, env)) return NOT_FOUND();
  const headers = { "set-cookie": cookieHeader("", 0), "cache-control": "no-store" };
  if (req.method === "GET") return new Response(null, { status: 303, headers: { ...headers, location: "/" } });
  return Response.json(ok({ loggedOut: true }), { headers });
}
