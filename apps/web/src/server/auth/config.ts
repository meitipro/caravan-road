// Auth.js (next-auth v5) with Google and Discord, JWT sessions (no database adapter).
// Provider credentials are inferred by Auth.js from AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET and
// AUTH_DISCORD_ID / AUTH_DISCORD_SECRET; AUTH_SECRET signs the session cookie.
// Docs: https://authjs.dev/getting-started/installation?framework=next.js
//       https://authjs.dev/getting-started/providers/discord (callback: /api/auth/callback/discord)
//       Google callback: /api/auth/callback/google
// Nothing here reads a secret itself and nothing runs at import time except building the config.

import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import Google from "next-auth/providers/google";
import type { SessionResolver, SessionUser } from "../guards/auth";

interface ExtendedToken { provider?: string; subject?: string; [k: string]: unknown }

export const { handlers, auth } = NextAuth({
  providers: [Google, Discord],
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  trustHost: true,
  callbacks: {
    jwt({ token, account }) {
      // `account` is only present on sign-in: remember who this is for the lifetime of the token.
      if (account) {
        (token as ExtendedToken).provider = account.provider;
        (token as ExtendedToken).subject = account.providerAccountId;
      }
      return token;
    },
    session({ session, token }) {
      const t = token as ExtendedToken;
      (session as unknown as ExtendedToken).provider = t.provider;
      (session as unknown as ExtendedToken).subject = t.subject;
      return session;
    },
  },
});

/** Production SessionResolver: reads the Auth.js session cookie. */
export const authSession: SessionResolver = async () => {
  const s = (await auth()) as unknown as (ExtendedToken & { user?: { email?: string | null; name?: string | null } }) | null;
  if (!s?.provider || !s.subject) return null;
  const out: SessionUser = {
    provider: s.provider, subject: s.subject, email: s.user?.email ?? null, name: s.user?.name ?? null,
  };
  return out;
};
