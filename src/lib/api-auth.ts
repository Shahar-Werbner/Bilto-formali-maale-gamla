import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Guards an API route. Returns the authenticated session, or a 401 response to
// return directly from the handler.
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      session: null,
      response: NextResponse.json({ error: "לא מחובר" }, { status: 401 }),
    } as const;
  }
  return { session, response: null } as const;
}
