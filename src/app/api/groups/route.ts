import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";

// GET /api/groups — all groups with their participants.
export async function GET() {
  const { response } = await requireCapability("group:view");
  if (response) return response;

  try {
    const groups = await prisma.group.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        participants: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return NextResponse.json(groups);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/groups — create a group. Body: { name }
export async function POST(request: Request) {
  const { response } = await requireCapability("group:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "שם קבוצה חסר" }, { status: 400 });
    }

    const group = await prisma.group.create({
      data: { name },
      include: { participants: true },
    });
    return NextResponse.json(group, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
