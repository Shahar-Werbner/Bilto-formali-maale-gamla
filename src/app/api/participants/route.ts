import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, sessionCapabilities } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { normalizePhone } from "@/lib/participants";

// GET /api/participants — the master list of all children.
export async function GET() {
  const { response } = await requireCapability("roster:view");
  if (response) return response;

  try {
    // Seeing the list and seeing the phone numbers are separate permissions.
    // A youth counselor marks attendance from this list; they have no reason to
    // hold every parent's number on their own phone, so the fields are dropped
    // from the query rather than hidden in the UI — data that is never sent
    // cannot leak through a devtools tab.
    const contacts = (await sessionCapabilities()).includes("roster:contacts");

    const participants = await prisma.participant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        grade: true,
        parentName: contacts,
        parentPhone: contacts,
        phone: contacts,
      },
    });
    return NextResponse.json(participants);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/participants — add a child to the master list.
// Body: { name, grade?, parentName?, parentPhone?, phone? }
// Optionally { groupId } to also add to a group.
export async function POST(request: Request) {
  const { response } = await requireCapability("roster:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";
    const str = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    if (!name) {
      return NextResponse.json({ error: "שם משתתף חסר" }, { status: 400 });
    }

    const participant = await prisma.participant.create({
      data: {
        name,
        grade: str(body?.grade),
        parentName: str(body?.parentName),
        parentPhone: str(body?.parentPhone)
          ? normalizePhone(String(body.parentPhone))
          : null,
        phone: str(body?.phone) ? normalizePhone(String(body.phone)) : null,
        ...(groupId ? { groups: { connect: { id: groupId } } } : {}),
      },
    });
    return NextResponse.json(participant, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
