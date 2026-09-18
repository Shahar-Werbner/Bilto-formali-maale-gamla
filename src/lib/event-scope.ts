import { NextResponse } from "next/server";

// Invariant 1 (CLAUDE.md): a soft-deleted Event has to be gone from every
// screen, export and report.
//
// The `/api/events` routes already filter it. The gap is everything reached by
// an **EventDay or ActivitySlot id**, because such an id says nothing about the
// event it hangs off — and a staff phone that had the day open when an admin
// deleted the event is still holding those ids. Without these filters, deleting
// an event stops it being listed but leaves it fully writable: attendance,
// schedule, description and participants all still land, and the attendance
// then skews the per-child report.
//
// Routes compose a filter from here instead of re-deriving the shape, so a new
// route is one import away from being correct rather than one oversight away
// from resurrecting a deleted event.

export const LIVE_EVENT = { deletedAt: null } as const;

/** An EventDay, only if its event is not soft-deleted. */
export function liveEventDay(id: string) {
  return { id, event: LIVE_EVENT };
}

/** An ActivitySlot, only if its day's event is not soft-deleted. */
export function liveActivitySlot(id: string) {
  return { id, eventDay: { event: LIVE_EVENT } };
}

/** The ActivitySlots of one day, only if that day's event is not soft-deleted. */
export function liveActivitySlotsOfDay(eventDayId: string) {
  return { eventDayId, eventDay: { event: LIVE_EVENT } };
}

/** An Event, only if it is not soft-deleted. */
export function liveEvent(id: string) {
  return { id, ...LIVE_EVENT };
}

// A deleted event answers the same way a never-existing one does. Telling the
// two apart would leak that the row is still there, and there is nothing the
// person on the phone could do with the difference anyway.
export function eventDayNotFound(): NextResponse {
  return NextResponse.json({ error: "יום לא נמצא" }, { status: 404 });
}

export function eventNotFound(): NextResponse {
  return NextResponse.json({ error: "אירוע לא נמצא" }, { status: 404 });
}

export function slotNotFound(): NextResponse {
  return NextResponse.json({ error: "הפעילות לא נמצאה" }, { status: 404 });
}
