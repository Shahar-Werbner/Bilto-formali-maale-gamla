import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, sessionCan } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import {
  eventDayNotFound,
  liveDayRow,
  liveEventDay,
  LIVE_EVENT,
} from "@/lib/event-scope";
import { ROLE_LABEL, isRole } from "@/lib/roles";
import { effectiveHours, parseShiftInput, staffing } from "@/lib/shifts";

// Who is working a session, and whether that is enough people.
//
// The daily question this answers is "who is coming on Tuesday, and are we
// short?" — not the monthly hours report (item 6), which reads the same rows.
//
// Assigning is an adult's job (the owner's decision, 19.09): if a counselor
// could put themselves on a session, the ratio alert would be bypassable —
// signing up for an easy session leaves a hole in another one, and the numbers
// still read fine.

// Everyone assigned is a counselor for the ratio; only these two are an adult.
const ADULT_ROLES = ["admin", "staff"];

// GET /api/shifts?eventDayId=… — the day's staff roster and its ratio.
//
// What comes back depends on the capability, not only what the screen chooses
// to render: without `shift:view:all` the answer holds the caller's own shift
// and nothing else. Who else is working, and how short the day is, is not a
// youth counselor's to read off their phone — and data that is not sent cannot
// leak.
export async function GET(request: Request) {
  const { session, response } = await requireCapability("shift:view:own");
  if (response) return response;

  try {
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
        startTime: true,
        endTime: true,
        event: {
          select: {
            maxChildrenPerStaff: true,
            // A deleted child is not coming, and must not inflate the number
            // the alert is computed from (invariant 1).
            _count: { select: { participants: { where: { deletedAt: null } } } },
          },
        },
      },
    });
    if (!day) return eventDayNotFound();

    const [canViewAll, canAssign] = await Promise.all([
      sessionCan("shift:view:all"),
      sessionCan("shift:assign"),
    ]);

    const rows = await prisma.shift.findMany({
      where: {
        eventDayId,
        eventDay: { event: LIVE_EVENT },
        ...(canViewAll ? {} : { userId: session.user.id }),
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        startTime: true,
        endTime: true,
        role: true,
        note: true,
        user: { select: { name: true, role: true } },
      },
    });

    const shifts = rows.map((s) => ({
      id: s.id,
      userId: s.userId,
      name: s.user.name,
      userRole: s.user.role,
      userRoleLabel: isRole(s.user.role) ? ROLE_LABEL[s.user.role] : s.user.role,
      role: s.role,
      note: s.note,
      ...effectiveHours(s, day),
    }));

    // The ratio needs the whole day's counts, which the list above no longer
    // holds when the caller may only see their own shift.
    let ratio = null;
    if (canViewAll) {
      const rostered = day.event._count.participants;
      const [markedTotal, here] = await Promise.all([
        prisma.eventAttendance.count({
          where: { eventDayId, participant: { deletedAt: null } },
        }),
        prisma.eventAttendance.count({
          where: {
            eventDayId,
            status: { in: ["present", "late"] },
            participant: { deletedAt: null },
          },
        }),
      ]);
      ratio = staffing({
        rosteredChildren: rostered,
        // Only a fully marked day has a real number — see src/lib/shifts.ts.
        markedChildren: rostered > 0 && markedTotal >= rostered ? here : null,
        staffCount: rows.length,
        adultCount: rows.filter((s) => ADULT_ROLES.includes(s.user.role)).length,
        maxChildrenPerStaff: day.event.maxChildrenPerStaff,
      });
    }

    // The picker. Everyone with an account can work a session — a youth
    // counselor is assigned like anyone else, they just cannot do the
    // assigning.
    const candidates = canAssign
      ? (
          await prisma.user.findMany({
            orderBy: { name: "asc" },
            select: { id: true, name: true, role: true },
          })
        ).map((u) => ({
          ...u,
          roleLabel: isRole(u.role) ? ROLE_LABEL[u.role] : u.role,
        }))
      : [];

    return NextResponse.json({
      day: { id: day.id, startTime: day.startTime, endTime: day.endTime },
      shifts,
      ratio,
      candidates,
      canViewAll,
      canAssign,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/shifts — put someone on a session, or change their hours on it.
// Body: { eventDayId, userId, startTime?, endTime?, role?, note? }
//
// An upsert on the (user, day) pair, which is what the unique constraint says:
// assigning someone twice is one shift, not two, and editing the hours of an
// existing one is the same act from the screen's point of view.
export async function POST(request: Request) {
  const { response } = await requireCapability("shift:assign");
  if (response) return response;

  try {
    const body = await request.json().catch(() => null);
    const eventDayId = typeof body?.eventDayId === "string" ? body.eventDayId : "";
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!eventDayId || !userId) {
      return NextResponse.json({ error: "נתונים חסרים" }, { status: 400 });
    }

    const parsed = parseShiftInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const day = await prisma.eventDay.findFirst({
      where: liveEventDay(eventDayId),
      select: { id: true, startTime: true, endTime: true },
    });
    if (!day) return eventDayNotFound();

    // An unknown id would only surface as a foreign-key error, which reaches
    // the phone as "something went wrong".
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
    }

    const shift = await prisma.shift.upsert({
      where: { userId_eventDayId: { userId, eventDayId } },
      update: parsed.value,
      create: { userId, eventDayId, ...parsed.value },
      select: {
        id: true,
        userId: true,
        startTime: true,
        endTime: true,
        role: true,
        note: true,
      },
    });

    return NextResponse.json({
      ...shift,
      name: user.name,
      userRole: user.role,
      userRoleLabel: isRole(user.role) ? ROLE_LABEL[user.role] : user.role,
      ...effectiveHours(shift, day),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/shifts?id=… — take someone off a session.
export async function DELETE(request: Request) {
  const { response } = await requireCapability("shift:assign");
  if (response) return response;

  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "חסר מזהה" }, { status: 400 });

    const deleted = await prisma.shift.deleteMany({ where: liveDayRow(id) });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "המשמרת לא נמצאה" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
