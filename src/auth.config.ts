import type { NextAuthConfig } from "next-auth";

// Edge-safe config: no Prisma / bcrypt here so it can be imported by the
// middleware (which runs on the Edge runtime). The Credentials provider with
// its Node-only dependencies is added in `auth.ts`.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [],
  callbacks: {
    // Runs in middleware for every matched request.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isPublic =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/register");

      if (isPublic) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/events", nextUrl));
        }
        return true; // allow access to login / register
      }
      return isLoggedIn; // everything else requires a session
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role?: string }).role ?? "staff";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
