import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, sessionCapabilities } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { eventDayNotFound, liveEventDay, LIVE_EVENT } from "@/lib/event-scope";
import { sortByGrade } from "@/lib/attendance";
import {
  dismissalExceptionReason,
  dismissalMethodOf,
  isDismissalException,
  isDismissalMethod,
} from "@/lib/dismissal";

// Signing children out of a session: the counterpart to attendance, and the
// part of this system that is safety-critical rather than administrative.

// GET /api/dismissals?eventDayId=... — the day's children, their standing
// instruction, who may collect them, and what has been recorded so far.
//
// One request for the whole screen: the person holding the phone at the gate
// needs the pickup list for the child in front of them *now*, and a per-child
// round trip at that moment is exactly when the network is worst.
export async function GET(request: Request) {
  const { response } = await requireCapability("dismissal:view");
  if (response) return response;

  try {
    const capabilities = await sessionCapabilities();
    const withPhones = capabilities.includes("roster:contacts");

    const { searchParams } = new URL(request.url);
    const eventDayId = searchParams.get("eventDayId") ?? "";
    if (!eventDayId) {
      return NextResponse.json({ error: "חסר מזהה יום" }, { status: 400 });
    }

    // The id of a day says nothing about whether its event still exists.
    const day = await prisma.eventDay.findFirst({
      where: liveEventDay(eventDayId),
      select: {
        id: true,
        event: {
          select: {
            participants: {
              where: { deletedAt: null },
              select: {
                id: true,
                name: true,
                grade: true,
                defaultDismissal: true,
                pickupAuth: {
                  orderBy: { createdAt: "asc" },
                  select: {
                    id: true,
                    name: true,
                    relation: true,
                    phone: withPhones,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!day) return eventDayNotFound();

    const records = await prisma.dismissal.findMany({
      where: { eventDayId },
      select: {
        participantId: true,
        method: true,
        pickedUpByName: true,
        note: true,
        at: true,
      },
    });
    const byParticipant = new Map(records.map((r) => [r.participantId, r]));

    const children = sortByGrade(day.event.participants).map((p) => {
      const record = byParticipant.get(p.id);
      return {
        participantId: p.id,
        name: p.name,
        grade: p.grade,
        defaultDismissal: dismissalMethodOf(p.defaultDismissal),
        authorizations: p.pickupAuth,
        dismissal: record
          ? {
              method: dismissalMethodOf(record.method),
              pickedUpByName: record.pickedUpByName,
              note: record.note,
              at: record.at?.toISOString() ?? null,
            }
          : null,
      };
    });

    return NextResponse.json({ children });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/dismissals — record how one child went home.
// Body: { eventDayId, participantId, method, pickedUpByName?, note? }
//
// The gate (see src/lib/dismissal.ts): a youth counselor may record a
// dismissal that matches the child's pickup list. A name that is not on it, a
// child sent home alone against their standing instruction, and a one-off note
// each need an adult — checked here, on the server, because the screen hiding
// a button is a convenience and this is not.
export async function POST(request: Request) {
  const { session, response } = await requireCapability("dismissal:mark");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const eventDayId = typeof body?.eventDayId === "string" ? body.eventDayId : "";
    const participantId =
      typeof body?.participantId === "string" ? body.participantId : "";
    const method = body?.method;
    const pickedUpByName =
      typeof body?.pickedUpByName === "string" ? body.pickedUpByName.trim() : "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    if (!eventDayId || !participantId || !isDismissalMethod(method)) {
      return NextResponse.json(
        { error: "נתונים חסרים או שגויים" },
        { status: 400 },
      );
    }

    // Same rule as attendance: only a child who is actually on this event, on a
    // day whose event has not been deleted.
    const day = await prisma.eventDay.findFirst({
      where: {
        id: eventDayId,
        event: {
          ...LIVE_EVENT,
          participants: { some: { id: participantId, deletedAt: null } },
        },
      },
      select: { id: true },
    });
    if (!day) {
      return NextResponse.json(
        { error: "המשתתף אינו רשום לאירוע זה" },
        { status: 404 },
      );
    }

    const participant = await prisma.participant.findFirst({
      where: { id: participantId, deletedAt: null },
      select: {
        defaultDismissal: true,
        pickupAuth: { select: { name: true } },
      },
    });
    if (!participant) {
      return NextResponse.json({ error: "ילד/ה לא נמצא/ה" }, { status: 404 });
    }

    const input = { method, pickedUpByName, note };
    const context = {
      defaultDismissal: dismissalMethodOf(participant.defaultDismissal),
      authorizations: participant.pickupAuth,
    };

    if (isDismissalException(input, context)) {
      const capabilities = await sessionCapabilities();
      if (!capabilities.includes("dismissal:authorize")) {
        // 403 with the reason, not a bare refusal: the screen turns this into
        // "an adult has to confirm this", which is something the person at the
        // gate can act on.
        return NextResponse.json(
          {
            error: dismissalExceptionReason(input, context),
            needsAdult: true,
          },
          { status: 403 },
        );
      }
    }

    const data = {
      method,
      // Nobody is "collected by" anyone when they walked home alone; keeping a
      // stale name there would make the record read as if someone took them.
      pickedUpByName: method === "escort" ? pickedUpByName || null : null,
      note: note || null,
      at: new Date(),
      markedByUserId: session.user.id,
    };

    const record = await prisma.dismissal.upsert({
      where: { eventDayId_participantId: { eventDayId, participantId } },
      update: data,
      create: { eventDayId, participantId, ...data },
      select: {
        participantId: true,
        method: true,
        pickedUpByName: true,
        note: true,
        at: true,
      },
    });

    return NextResponse.json({
      ...record,
      at: record.at?.toISOString() ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/dismissals?eventDayId=...&participantId=... — undo a record.
//
// Adults only, and deliberately not the mirror of POST. Recording a dismissal
// is the routine act; erasing one removes the answer to "who took this child
// home", which is the question this table exists to answer. A youth counselor
// who marked the wrong child fixes it by recording the right thing, which goes
// back through the gate above.
export async function DELETE(request: Request) {
  const { response } = await requireCapability("dismissal:authorize");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const eventDayId = searchParams.get("eventDayId") ?? "";
    const participantId = searchParams.get("participantId") ?? "";
    if (!eventDayId || !participantId) {
      return NextResponse.json({ error: "חסרים מזהים" }, { status: 400 });
    }

    const deleted = await prisma.dismissal.deleteMany({
      where: {
        participantId,
        eventDayId,
        eventDay: { event: LIVE_EVENT },
      },
    });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "לא נמצא סימון" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
