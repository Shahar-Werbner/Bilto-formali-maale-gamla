import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { isRole } from "@/lib/roles";
import { handleApiError } from "@/lib/api-error";

// PATCH /api/admin/users/:id — change a user's role. Body: { role }
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { session, response } = await requireAdmin();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const role = body?.role;
    if (!isRole(role)) {
      return NextResponse.json({ error: "תפקיד לא תקין" }, { status: 400 });
    }

    // Demoting yourself is how a team ends up with no admin and no way back.
    if (params.id === session.user.id && role !== "admin") {
      return NextResponse.json(
        { error: "אי אפשר להוריד לעצמך את הרשאות הניהול" },
        { status: 400 },
      );
    }
    // Same outcome by a different route: the last admin stepping down.
    if (role !== "admin") {
      const admins = await prisma.user.count({ where: { role: "admin" } });
      const target = await prisma.user.findUnique({
        where: { id: params.id },
        select: { role: true },
      });
      if (admins <= 1 && target?.role === "admin") {
        return NextResponse.json(
          { error: "חייב להישאר לפחות מנהל/ת אחד/ת" },
          { status: 400 },
        );
      }
    }

    const user = await prisma.user.update({
      where: { id: params.id },
      data: { role },
      select: { id: true, name: true, email: true, role: true },
    });
    return NextResponse.json(user);
  } catch (err) {
    return handleApiError(err);
  }
}
