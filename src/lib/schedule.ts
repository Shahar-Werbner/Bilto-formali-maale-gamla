// The approval loop around the day's schedule (item 4, stage B).
//
// A youth counselor plans the activity they run; an adult signs it off. The
// rules live here, free of Prisma and NextAuth, because they decide who may
// change what — and that is worth reading in one place and testing directly
// rather than inferring from three route files.
//
// `ActivitySlot.status` defaults to "approved" in the database, and that
// default is the reason this was safe to add to a live schedule: every slot
// that already existed, and every slot an adult writes from now on, is part of
// the day. Only a slot written by someone who needs sign-off is set to
// "pending", explicitly, by the route that writes it.

export const SLOT_STATUSES = ["approved", "pending", "draft"] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export function isSlotStatus(value: unknown): value is SlotStatus {
  return (
    typeof value === "string" && (SLOT_STATUSES as readonly string[]).includes(value)
  );
}

// An unknown status string — written straight into the database, or left by a
// version that knew a fourth one — must not read as "approved". Anything that
// is not a status this version understands is shown as waiting, because the
// unsafe direction here is a plan nobody checked being taken for the day's.
export function slotStatusOf(value: unknown): SlotStatus {
  return isSlotStatus(value) ? value : "pending";
}

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  approved: "מאושר",
  pending: "ממתין לאישור",
  draft: "הוחזר לתיקון",
};

/**
 * The status a newly written slot gets.
 *
 * Someone who may edit the schedule approves it by writing it — asking them to
 * then approve their own row would be a loop with nothing in it. Someone who
 * may only propose gets "pending", and the screen tells them it was sent.
 */
export function statusForNewSlot(canEdit: boolean): SlotStatus {
  return canEdit ? "approved" : "pending";
}

/**
 * May this person change (or delete) this slot?
 *
 * An adult may change anything. A youth counselor may change a slot that is
 * not yet part of the day — their own proposal, or one an adult sent back for
 * a fix — and may not touch an approved one.
 *
 * The rule is by status rather than by author because `ActivitySlot` has no
 * `createdByUserId` column and adding one is a migration, which this item does
 * not include. The cost is that one youth counselor can edit another's
 * un-approved proposal; the blast radius is a row that is not part of the day
 * yet, and the alternative — a teenager having to find an adult to fix their
 * own typo — is the friction that stops the loop being used at all.
 */
export function canChangeSlot({
  status,
  canEdit,
  canPropose,
}: {
  status: unknown;
  canEdit: boolean;
  canPropose: boolean;
}): boolean {
  if (canEdit) return true;
  if (!canPropose) return false;
  return slotStatusOf(status) !== "approved";
}

/**
 * The status a slot carries after someone edits it.
 *
 * An adult editing an approved slot leaves it approved. A proposer editing a
 * slot that was sent back for a fix puts it back in the queue — otherwise a
 * corrected plan would sit in "הוחזר לתיקון" forever, waiting for a
 * re-submission button nobody built.
 */
export function statusAfterEdit({
  status,
  canEdit,
}: {
  status: unknown;
  canEdit: boolean;
}): SlotStatus {
  const current = slotStatusOf(status);
  if (canEdit) return current;
  return current === "approved" ? current : "pending";
}

/** How many of a day's slots are waiting for an adult. */
export function pendingCount(slots: readonly { status?: unknown }[]): number {
  return slots.filter((s) => slotStatusOf(s.status) === "pending").length;
}
