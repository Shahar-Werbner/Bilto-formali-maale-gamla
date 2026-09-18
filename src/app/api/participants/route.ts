import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";

// GET /api/participants — the master list of all children.
export async function GET() {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const participants = await prisma.participant.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, grade: true },
    });
    return NextResponse.json(participants);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/participants — add a child to the master list.
// Body: { name, grade? }  Optionally { groupId } to also add to a group.
export async function POST(request: Request) {
  const { response } = await requireSession();
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const grade =
      typeof body?.grade === "string" && body.grade.trim()
        ? body.grade.trim()
        : null;

    if (!name) {
      return NextResponse.json({ error: "שם משתתף חסר" }, { status: 400 });
    }

    const participant = await prisma.participant.create({
      data: {
        name,
        grade,
        ...(groupId ? { groups: { connect: { id: groupId } } } : {}),
      },
    });
    return NextResponse.json(participant, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
