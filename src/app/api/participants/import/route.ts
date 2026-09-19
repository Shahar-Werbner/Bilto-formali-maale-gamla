import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { liveGroup } from "@/lib/event-scope";
import {
  normalizePhone,
  partitionByExisting,
  type ImportRow,
} from "@/lib/participants";

// A whole year's roster at once, but not an unbounded request.
const MAX_ROWS = 500;

// POST /api/participants/import — add many children in one go.
// Body: { rows: [{ name, grade?, parentName?, parentPhone? }], groupId? }
// Children whose name already exists are skipped rather than duplicated, so
// importing the same list twice is safe.
export async function POST(request: Request) {
  const { response } = await requireCapability("roster:edit");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const raw = Array.isArray(body?.rows) ? body.rows : null;
    const groupId = typeof body?.groupId === "string" ? body.groupId : "";

    if (!raw || raw.length === 0) {
      return NextResponse.json({ error: "אין שורות לייבוא" }, { status: 400 });
    }
    if (raw.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `אפשר לייבא עד ${MAX_ROWS} ילדים בבת אחת` },
        { status: 413 },
      );
    }

    const rows: ImportRow[] = [];
    for (const item of raw) {
      const name =
        typeof item?.name === "string" ? item.name.replace(/\s+/g, " ").trim() : "";
      if (!name) continue;
      const str = (v: unknown) =>
        typeof v === "string" && v.trim() ? v.trim() : null;
      rows.push({
        name,
        grade: str(item?.grade),
        parentName: str(item?.parentName),
        parentPhone: str(item?.parentPhone)
          ? normalizePhone(String(item.parentPhone))
          : null,
      });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "אין שורות תקינות" }, { status: 400 });
    }

    if (groupId && !(await prisma.group.findFirst({ where: liveGroup(groupId) }))) {
      return NextResponse.json({ error: "קבוצה לא נמצאה" }, { status: 400 });
    }

    // Compare against every name, deleted ones included: re-importing a child
    // who was removed should surface as a skip the user can resolve from
    // /admin, not silently create a second copy of them.
    const existing = await prisma.participant.findMany({
      select: { name: true },
    });
    const { fresh, duplicate } = partitionByExisting(
      rows,
      existing.map((p) => p.name),
    );

    if (fresh.length > 0) {
      await prisma.$transaction(
        fresh.map((row) =>
          prisma.participant.create({
            data: {
              name: row.name,
              grade: row.grade,
              parentName: row.parentName,
              parentPhone: row.parentPhone,
              ...(groupId ? { groups: { connect: { id: groupId } } } : {}),
            },
          }),
        ),
      );
    }

    return NextResponse.json(
      {
        added: fresh.length,
        skipped: duplicate.length,
        skippedNames: duplicate.map((r) => r.name),
      },
      { status: fresh.length > 0 ? 201 : 200 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
