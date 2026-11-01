// Guards for the local development backend. The dev backend and the dev login exist only for
// `pnpm dev` on a developer machine: they refuse to start in production, outside PLAY mode, and the login
// route answers 404 unless every condition holds.

type Env = Record<string, string | undefined>;

export function isDevBackend(env: Env = process.env): boolean {
  return env.SERVER_BACKEND === "dev";
}

/** Throws at startup if a dev switch is set where it must never be. */
export function assertDevFlagsSafe(env: Env = process.env): void {
  const devSwitch = env.DEV_LOGIN === "1" || isDevBackend(env);
  if (!devSwitch) return;
  if (env.NODE_ENV === "production") {
    throw new Error("DEV_LOGIN=1 and SERVER_BACKEND=dev are refused when NODE_ENV=production");
  }
  if (env.GAME_MODE !== "PLAY") {
    throw new Error("DEV_LOGIN=1 and SERVER_BACKEND=dev require GAME_MODE=PLAY");
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalHostHeader(host: string | null): boolean {
  if (!host) return false;
  const bare = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return LOCAL_HOSTS.has(bare.toLowerCase());
}

/** All four conditions of the dev login: not production, DEV_LOGIN=1, PLAY, and a purely local request. */
export function devLoginAllowed(req: Request, env: Env = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  if (env.DEV_LOGIN !== "1") return false;
  if (env.GAME_MODE !== "PLAY") return false;
  // Next's dev server itself adds x-forwarded-* headers, so only a NON-local forwarded host disqualifies the request.
  const fwd = req.headers.get("x-forwarded-host");
  if (fwd && !isLocalHostHeader(fwd)) return false;
  let urlHost: string;
  try {
    urlHost = new URL(req.url).hostname;
  } catch {
    return false;
  }
  const bracketed = urlHost.includes(":") && !urlHost.startsWith("[") ? `[${urlHost}]` : urlHost; // WHATWG keeps the brackets of IPv6 hosts
  return isLocalHostHeader(req.headers.get("host")) && isLocalHostHeader(bracketed);
}
