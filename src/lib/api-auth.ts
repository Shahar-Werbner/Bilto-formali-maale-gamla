import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export { ROLES, isRole, type Role } from "@/lib/roles";

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

// Same, but also requires the admin role. Used for the operations that destroy
// or hand out access: deleting an event or a child, restoring one, and changing
// anyone's role. Everything else is open to any staff account.
//
// The role is re-read from the database rather than taken from the JWT: the
// token is issued at sign-in and lives for days, so trusting it would leave a
// demoted admin with admin powers until they happen to log in again. The extra
// query only runs on these few operations.
export async function requireAdmin() {
  const { session, response } = await requireSession();
  if (response) return { session: null, response } as const;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (user?.role !== "admin") {
    return {
      session: null,
      response: NextResponse.json(
        { error: "הפעולה הזו מותרת למנהל/ת בלבד" },
        { status: 403 },
      ),
    } as const;
  }
  return { session, response: null } as const;
}
