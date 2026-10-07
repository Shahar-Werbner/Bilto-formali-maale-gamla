import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { eventNotFound, liveEvent } from "@/lib/event-scope";
import {
  formState,
  generateRegistrationToken,
  parseFormSettings,
  sameList,
} from "@/lib/registration";

// The event's registration settings and its link (item 8). `registration:manage`
// — an adult's: the link is an unauthenticated write into the roster.

// PUT /api/events/<id>/registration — create or update the settings.
// Body: { intro, price, capacity, autoApprove, closesAt ("YYYY-MM-DDTHH:mm",
//         Israel time), equipment: string[], dayEquipment: { [dayId]: string[] } }
export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("registration:manage");
  if (response) return response;

  try {
    const event = await prisma.event.findFirst({
      where: liveEvent(params.id),
      select: {
        id: true,
        registration: { select: { equipment: true } },
        days: { select: { id: true, equipment: true } },
      },
    });
    if (!event) return eventNotFound();

    const parsed = parseFormSettings(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const s = parsed.value;

    const dayById = new Map(event.days.map((d) => [d.id, d]));
    for (const dayId of Object.keys(s.dayEquipment)) {
      if (!dayById.has(dayId)) {
        return NextResponse.json({ error: "יום לא שייך לאירוע" }, { status: 400 });
      }
    }

    // "עודכן" on the form is about the lists, not the opening text: a parent
    // coming back to the link needs to see that what to pack has changed.
    const equipmentChanged =
      !sameList(event.registration?.equipment ?? [], s.equipment) ||
      Object.entries(s.dayEquipment).some(
        ([dayId, list]) => !sameList(dayById.get(dayId)!.equipment, list),
      );

    const data = {
      intro: s.intro,
      price: s.price,
      capacity: s.capacity,
      autoApprove: s.autoApprove,
      closesAt: s.closesAt,
      equipment: s.equipment,
      ...(equipmentChanged ? { equipmentUpdatedAt: new Date() } : {}),
    };

    await prisma.$transaction([
      prisma.registrationForm.upsert({
        where: { eventId: event.id },
        update: data,
        create: { ...data, eventId: event.id, token: generateRegistrationToken() },
      }),
      ...Object.entries(s.dayEquipment).map(([dayId, equipment]) =>
        prisma.eventDay.updateMany({ where: { id: dayId, eventId: event.id }, data: { equipment } }),
      ),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/events/<id>/registration — the link.
// Body: { action: "open" | "close" | "reissue" }
//   open    — send it: the form starts taking registrations (also reopens one
//             closed by hand).
//   close   — the "close registration" button.
//   reissue — a new token; the old link stops working at once.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireCapability("registration:manage");
  if (response) return response;

  try {
    const form = await prisma.registrationForm.findFirst({
      where: { eventId: params.id, event: { deletedAt: null } },
      select: { id: true, openedAt: true, closesAt: true, closedAt: true },
    });
    if (!form) {
      return NextResponse.json(
        { error: "צריך לשמור את הגדרות ההרשמה קודם" },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => null);
    const action = body?.action;
    const now = new Date();

    let data;
    if (action === "open") {
      if (form.closesAt && form.closesAt.getTime() <= now.getTime()) {
        return NextResponse.json(
          { error: "מועד הסגירה כבר עבר — צריך לעדכן אותו לפני הפתיחה" },
          { status: 400 },
        );
      }
      data = { openedAt: form.openedAt ?? now, closedAt: null };
    } else if (action === "close") {
      data = { closedAt: now };
    } else if (action === "reissue") {
      data = { token: generateRegistrationToken() };
    } else {
      return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
    }

    const updated = await prisma.registrationForm.update({
      where: { id: form.id },
      data,
      select: { token: true, openedAt: true, closesAt: true, closedAt: true },
    });
    return NextResponse.json({ token: updated.token, state: formState(updated, now) });
  } catch (err) {
    return handleApiError(err);
  }
}
