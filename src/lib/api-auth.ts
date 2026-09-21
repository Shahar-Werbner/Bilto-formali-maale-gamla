import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { can, capabilitiesOf, isRole, type Capability, type Role } from "@/lib/roles";

export { ROLES, isRole, type Role } from "@/lib/roles";
export type { Capability } from "@/lib/roles";

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

// Guards a route by capability rather than by role name. This is the one to
// reach for: `requireCapability("roster:edit")` says what the route does, so
// adding a fourth role is a line in the table in roles.ts rather than an edit
// to every route that happens to mention a role.
//
// Like requireAdmin, the role is re-read from the database and not taken from
// the JWT — see the note there.
export async function requireCapability(capability: Capability) {
  const { session, response } = await requireSession();
  if (response) return { session: null, response } as const;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (!isRole(user?.role) || !can(user.role, capability)) {
    return {
      session: null,
      response: NextResponse.json(
        { error: "אין לך הרשאה לפעולה הזו" },
        { status: 403 },
      ),
    } as const;
  }
  return { session, response: null } as const;
}

// The signed-in user's capabilities, for deciding what to render. The server
// still checks on every write — this only keeps the UI from offering a button
// that would come back 403.
export async function sessionCapabilities(): Promise<readonly Capability[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  return capabilitiesOf(user?.role);
}

// Whether the signed-in user holds one more capability, for a route whose
// *behaviour* depends on the answer rather than its access: the schedule
// accepts a write from anyone who may propose, and what changes with
// `schedule:edit` is whether the slot lands approved or waiting. Guarding such
// a route on the narrower capability and branching on the wider one keeps one
// route rather than two that drift apart.
export async function sessionCan(capability: Capability): Promise<boolean> {
  return (await sessionCapabilities()).includes(capability);
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
