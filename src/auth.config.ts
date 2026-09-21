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

      // The parents' page (item 5). It is open because there are no parent
      // accounts: the long random token in the path is the credential, and it
      // is checked server-side on every read and write — see
      // src/lib/parent-link.ts. It is listed separately from the sign-in pages
      // because it must NOT redirect a signed-in visitor to /events: a
      // counselor is also somebody's parent, and opening the family link from
      // their own phone has to show the child, not bounce them to the roster.
      if (nextUrl.pathname.startsWith("/p/")) return true;

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
