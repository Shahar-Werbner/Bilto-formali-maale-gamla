import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-error";
import {
  PARENT_READ_LIMIT,
  PARENT_WRITE_LIMIT,
  parseParentAnswer,
} from "@/lib/parents";
import {
  parentDays,
  parentMayWriteDay,
  resolveParentLink,
  touchParentLink,
} from "@/lib/parent-link";

// The parent's endpoint. **This is the one unauthenticated write into a child's
// record**, and the token in the URL is the whole proof — there are no parent
// accounts (see src/lib/parents.ts for why).
//
// What that means for everything below: the token is checked for shape before
// any query, both verbs are throttled, and the blast radius of a leaked link is
// deliberately tiny — it can set one boolean and one short note, for one child,
// on days that child is already on. It cannot read contacts, cannot see other
// children, cannot record that a child went home, and cannot reach a day the
// child is not on even if the id is guessed correctly.

function callerIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

function tooMany(): NextResponse {
  return NextResponse.json(
    { error: "יותר מדי בקשות. נסו שוב בעוד כמה דקות." },
    { status: 429 },
  );
}

// A link that does not resolve answers the same way whether the token is
// nonsense or belongs to a child who was removed. A revoked link is the one
// case worth telling apart: the family is holding a token they already had, so
// confirming it used to work leaks nothing, and "ask the staff for a new link"
// is something they can act on, where a blank 404 is not.
function linkFailure(reason: "unknown" | "revoked"): NextResponse {
  if (reason === "revoked") {
    return NextResponse.json(
      { error: "הקישור כבר לא פעיל. אפשר לבקש מהצוות קישור חדש.", revoked: true },
      { status: 410 },
    );
  }
  return NextResponse.json({ error: "הקישור לא נמצא" }, { status: 404 });
}

// GET /api/parent/<token> — the child's next sessions and what the family
// already said about each.
export async function GET(
  request: Request,
  { params }: { params: { token: string } },
) {
  if (PARENT_READ_LIMIT.check(callerIp(request))) return tooMany();

  try {
    const link = await resolveParentLink(params.token);
    if (!link.ok) return linkFailure(link.reason);

    await touchParentLink(link.linkId);

    return NextResponse.json({
      child: link.participant,
      label: link.label,
      days: await parentDays(link.participant.id),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/parent/<token> — "coming" or "not coming" for one day, plus an
// optional note.
// Body: { eventDayId, coming, note? }
export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  if (PARENT_WRITE_LIMIT.check(callerIp(request))) return tooMany();

  try {
    const link = await resolveParentLink(params.token);
    if (!link.ok) return linkFailure(link.reason);

    const body = await request.json().catch(() => null);
    const eventDayId =
      typeof body?.eventDayId === "string" ? body.eventDayId : "";
    if (!eventDayId) {
      return NextResponse.json({ error: "חסר מזהה יום" }, { status: 400 });
    }

    const answer = parseParentAnswer(body);
    if (!answer.ok) {
      return NextResponse.json({ error: answer.error }, { status: 400 });
    }

    // The day id came from an open endpoint. A link for one child is not a way
    // to write a row for a session that child is not on, nor for a day whose
    // event has been deleted.
    if (!(await parentMayWriteDay(link.participant.id, eventDayId))) {
      return NextResponse.json({ error: "היום לא נמצא" }, { status: 404 });
    }

    await touchParentLink(link.linkId);

    const data = { coming: answer.value.coming, note: answer.value.note };
    const record = await prisma.expectedAttendance.upsert({
      where: {
        eventDayId_participantId: { eventDayId, participantId: link.participant.id },
      },
      update: data,
      create: { eventDayId, participantId: link.participant.id, ...data },
      select: { coming: true, note: true },
    });

    return NextResponse.json({ eventDayId, ...record });
  } catch (err) {
    return handleApiError(err);
  }
}
