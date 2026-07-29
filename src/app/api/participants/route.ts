import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";

// POST /api/participants — add a participant to a group.
// Body: { name, groupId }
export async function POST(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const groupId = typeof body?.groupId === "string" ? body.groupId : "";

  if (!name || !groupId) {
    return NextResponse.json(
      { error: "שם משתתף או קבוצה חסרים" },
      { status: 400 },
    );
  }

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) {
    return NextResponse.json({ error: "קבוצה לא נמצאה" }, { status: 404 });
  }

  const participant = await prisma.participant.create({
    data: { name, groupId },
  });
  return NextResponse.json(participant, { status: 201 });
}
