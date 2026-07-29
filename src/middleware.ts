import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Middleware uses only the Edge-safe config. Page routes are protected via the
// `authorized` callback; API routes enforce their own session checks and are
// excluded from the matcher below.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    // Run on everything except: api routes, Next internals, and static files.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
