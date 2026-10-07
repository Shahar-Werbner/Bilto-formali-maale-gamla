// The registration form against the database (item 8). Server-only.
//
// Everything that turns a submission into rows lives here, in one place, for
// the same reason src/lib/parent-link.ts does: the public page, the public
// route and the staff screens must agree exactly on what "open", "the days
// this form asks about" and "holds a place" mean, and two copies of a rule is
// one copy that stops being updated.

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDateOnly, sortByGrade, todayDateOnly } from "@/lib/attendance";
import { LIVE_EVENT } from "@/lib/event-scope";
import { isSameAuthorization } from "@/lib/dismissal";
import { isEventKind } from "@/lib/events";
import { normalizeName, normalizePhone } from "@/lib/participants";
import {
  comingAnyDay,
  dateToIsraelLocal,
  decideStatus,
  formDays,
  formState,
  holdsPlace,
  isRegistrationToken,
  parentOutcome,
  reviewFor,
  type ChildSubmission,
  type FormState,
  type ReviewReason,
} from "@/lib/registration";

/** A refusal with the status the route should answer with. */
export class RegistrationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// ── Does this event count by registration ───────────────────────────────────

/**
 * Whether the expected number for this event comes from registrations (only
 * an explicit yes counts) rather than item 5's "silence means coming".
 *
 * True from the moment the link is sent. A form the staff are still setting up
 * has asked nobody anything, so it changes nothing yet.
 */
export async function eventsUsingRegistration(
  eventIds: readonly string[],
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const forms = await prisma.registrationForm.findMany({
    where: { eventId: { in: [...eventIds] }, openedAt: { not: null } },
    select: { eventId: true },
  });
  return new Set(forms.map((f) => f.eventId));
}

export async function eventUsesRegistration(eventId: string): Promise<boolean> {
  return (await eventsUsingRegistration([eventId])).has(eventId);
}

// ── The public side ─────────────────────────────────────────────────────────

const PUBLIC_FORM_SELECT = {
  id: true,
  intro: true,
  price: true,
  capacity: true,
  autoApprove: true,
  openedAt: true,
  closesAt: true,
  closedAt: true,
  equipment: true,
  equipmentUpdatedAt: true,
  event: {
    select: {
      id: true,
      name: true,
      kind: true,
      deletedAt: true,
      days: {
        orderBy: { date: "asc" },
        select: { id: true, date: true, startTime: true, endTime: true, equipment: true },
      },
    },
  },
} satisfies Prisma.RegistrationFormSelect;

type FormRow = Prisma.RegistrationFormGetPayload<{ select: typeof PUBLIC_FORM_SELECT }>;

export type FormDay = {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  equipment: string[];
};

export type OpenForm = {
  formId: string;
  eventId: string;
  eventName: string;
  intro: string | null;
  price: string | null;
  closesAt: string | null; // Israel wall-clock "YYYY-MM-DDTHH:mm"
  equipment: string[];
  /** The equipment lists changed after the link went out. */
  equipmentUpdated: boolean;
  days: FormDay[];
  capacity: number | null;
  autoApprove: boolean;
};

export type FormResolution =
  | { state: "unknown" }
  | { state: "closed" | "draft" | "no-days"; eventName: string }
  | { state: "open"; form: OpenForm };

function viewOf(row: FormRow, today: string): OpenForm {
  const kind = isEventKind(row.event.kind) ? row.event.kind : "camp";
  const days = formDays(
    row.event.days.map((d) => ({
      id: d.id,
      date: formatDateOnly(d.date),
      startTime: d.startTime,
      endTime: d.endTime,
      equipment: d.equipment,
    })),
    kind,
    today,
  );
  return {
    formId: row.id,
    eventId: row.event.id,
    eventName: row.event.name,
    intro: row.intro,
    price: row.price,
    closesAt: row.closesAt ? dateToIsraelLocal(row.closesAt) : null,
    equipment: row.equipment,
    equipmentUpdated: Boolean(
      row.openedAt &&
        row.equipmentUpdatedAt &&
        row.equipmentUpdatedAt.getTime() > row.openedAt.getTime(),
    ),
    days,
    capacity: row.capacity,
    autoApprove: row.autoApprove,
  };
}

/**
 * The form a token opens, or why it does not open.
 *
 * Shape first, so a junk token costs no query. A deleted event answers like an
 * unknown token (invariant 1). A reissued link's old token simply no longer
 * matches any row, which is the whole of "the old one stops working at once".
 */
export async function resolveRegistrationForm(
  token: unknown,
  now: Date = new Date(),
): Promise<FormResolution> {
  if (!isRegistrationToken(token)) return { state: "unknown" };

  const row = await prisma.registrationForm.findUnique({
    where: { token },
    select: PUBLIC_FORM_SELECT,
  });
  if (!row || row.event.deletedAt) return { state: "unknown" };

  const state: FormState = formState(row, now);
  if (state !== "open") return { state, eventName: row.event.name };

  const form = viewOf(row, todayDateOnly(now));
  if (form.days.length === 0) return { state: "no-days", eventName: row.event.name };
  return { state: "open", form };
}

/** Name and grade, nothing else — and only ever called for an open form. */
export async function formChildren() {
  return sortByGrade(
    await prisma.participant.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, grade: true },
    }),
  );
}

/** Whether a new registration would go to the waiting list right now. */
export async function formIsFull(form: { formId: string; capacity: number | null }) {
  if (form.capacity === null) return false;
  const [taken, waiting] = await Promise.all([
    countPlaces(prisma, form.formId),
    prisma.registration.count({ where: { formId: form.formId, status: "waitlist" } }),
  ]);
  return taken >= form.capacity || waiting > 0;
}

type Tx = Prisma.TransactionClient | typeof prisma;

function countPlaces(tx: Tx, formId: string, excludeId?: string): Promise<number> {
  return tx.registration.count({
    where: {
      formId,
      status: "approved",
      participant: { deletedAt: null },
      days: { some: { coming: true } },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

// Two families submitting in the same second must not both take the last
// place. Every write that can change who holds a place takes this row lock
// first, so they queue behind one another.
async function lockForm(tx: Prisma.TransactionClient, formId: string) {
  await tx.$queryRaw`SELECT id FROM "RegistrationForm" WHERE id = ${formId} FOR UPDATE`;
}

/** Writes the approved registration's answers where the day screen and the kitchen read them. */
async function writeExpected(
  tx: Prisma.TransactionClient,
  participantId: string,
  eventId: string,
  days: readonly { eventDayId: string; coming: boolean; bringsFood: boolean | null }[],
) {
  // "Add the child to the event" is part of registering — a child who
  // registered and then does not appear on the attendance list is the bug.
  await tx.event.update({
    where: { id: eventId },
    data: { participants: { connect: { id: participantId } } },
  });
  for (const d of days) {
    const data = { coming: d.coming, bringsFood: d.bringsFood };
    await tx.expectedAttendance.upsert({
      where: { eventDayId_participantId: { eventDayId: d.eventDayId, participantId } },
      update: data,
      create: { eventDayId: d.eventDayId, participantId, ...data },
    });
  }
}

export type SubmitResult = { name: string; outcome: "received" | "waitlist" };

/**
 * Saves one family's submission, all children or none.
 *
 * Per child: find the registration this replaces (a resubmission replaces, it
 * never adds a second row), work out what has to wait for an adult, decide
 * the status against the cap, and — only when approved — write the answers
 * into ExpectedAttendance.
 *
 * Nothing here writes a parent's phone, "goes home alone" or a new pickup
 * person onto a child's record. The one exception is tightening "alone" to
 * "escort", which is the safe direction (see reviewFor).
 */
export async function submitRegistration(
  form: OpenForm,
  entries: readonly ChildSubmission[],
  now: Date = new Date(),
): Promise<SubmitResult[]> {
  return prisma.$transaction(
    async (tx) => {
      await lockForm(tx, form.formId);
      const results: SubmitResult[] = [];

      for (const entry of entries) {
        let stored: Awaited<ReturnType<typeof loadStored>> = null;
        let existing: Awaited<ReturnType<typeof findExisting>> = null;

        if (entry.child.kind === "existing") {
          stored = await loadStored(tx, entry.child.participantId);
          // Same answer for a made-up id and a deleted child; the list on the
          // page only ever offered live ones.
          if (!stored) throw new RegistrationError("הילד/ה שנבחר/ה לא נמצא/ה ברשימה", 400);
          existing = await findExisting(tx, form.formId, { participantId: stored.id });
        } else {
          existing = await findExisting(tx, form.formId, {
            newChild: entry.child.name,
            parentPhone: entry.parentPhone,
          });
        }

        const review = reviewFor(entry, stored);
        const coming = comingAnyDay(entry.days);
        const [placesTaken, waitlistAhead] = await Promise.all([
          countPlaces(tx, form.formId, existing?.id),
          tx.registration.count({
            where: {
              formId: form.formId,
              status: "waitlist",
              createdAt: { lt: existing?.createdAt ?? now },
              ...(existing ? { id: { not: existing.id } } : {}),
            },
          }),
        ]);
        const status = decideStatus({
          isNew: entry.child.kind === "new",
          autoApprove: form.autoApprove,
          capacity: form.capacity,
          placesTaken,
          waitlistAhead,
          coming,
          alreadyHoldsPlace: Boolean(
            existing && holdsPlace(existing.status, existing.days.some((d) => d.coming)),
          ),
        });

        if (review.tightenToEscort && stored) {
          await tx.participant.update({
            where: { id: stored.id },
            data: { defaultDismissal: "escort" },
          });
        }

        // A review an adult already did stays done if the family is asking
        // the same thing again — they changed Wednesday, not who collects.
        const sameRequest =
          existing !== null &&
          existing.dismissal === entry.dismissal &&
          (existing.pickupName ?? null) === (entry.pickup?.name ?? null) &&
          (existing.pickupPhone ?? null) === (entry.pickup?.phone ?? null) &&
          existing.parentPhone === entry.parentPhone;

        const data = {
          parentName: entry.parentName,
          parentPhone: entry.parentPhone,
          dismissal: entry.dismissal,
          pickupName: entry.pickup?.name ?? null,
          pickupRelation: entry.pickup?.relation ?? null,
          pickupPhone: entry.pickup?.phone ?? null,
          note: entry.note,
          equipmentAck: entry.equipmentAck,
          status,
          reviewReasons: review.reasons,
          ...(review.reasons.length > 0 && !sameRequest
            ? { reviewedAt: null, reviewedByUserId: null }
            : {}),
          submittedAt: now,
          ...(entry.child.kind === "new"
            ? { childName: entry.child.name, childGrade: entry.child.grade }
            : {}),
        };

        const reg = existing
          ? await tx.registration.update({
              where: { id: existing.id },
              data: { ...data, revision: { increment: 1 } },
              select: { id: true },
            })
          : await tx.registration.create({
              data: {
                ...data,
                formId: form.formId,
                participantId: stored?.id ?? null,
              },
              select: { id: true },
            });

        const days = Object.entries(entry.days).map(([eventDayId, a]) => ({
          eventDayId,
          coming: a.coming,
          bringsFood: a.bringsFood,
        }));
        for (const d of days) {
          await tx.registrationDay.upsert({
            where: {
              registrationId_eventDayId: { registrationId: reg.id, eventDayId: d.eventDayId },
            },
            update: { coming: d.coming, bringsFood: d.bringsFood },
            create: { registrationId: reg.id, ...d },
          });
        }

        if (status === "approved" && stored) {
          await writeExpected(tx, stored.id, form.eventId, days);
        }

        results.push({
          name: stored?.name ?? (entry.child.kind === "new" ? entry.child.name : ""),
          outcome: parentOutcome(status),
        });
      }
      return results;
    },
    { timeout: 20000 },
  );
}

function loadStored(tx: Tx, participantId: string) {
  return tx.participant
    .findFirst({
      where: { id: participantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        defaultDismissal: true,
        parentPhone: true,
        pickupAuth: { select: { name: true, phone: true } },
      },
    })
    .then((p) => (p ? { ...p, authorizations: p.pickupAuth } : null));
}

async function findExisting(
  tx: Tx,
  formId: string,
  key: { participantId: string } | { newChild: string; parentPhone: string },
) {
  const select = {
    id: true,
    status: true,
    createdAt: true,
    dismissal: true,
    pickupName: true,
    pickupPhone: true,
    parentPhone: true,
    childName: true,
    days: { select: { coming: true } },
  } as const;

  if ("participantId" in key) {
    return tx.registration.findUnique({
      where: { formId_participantId: { formId, participantId: key.participantId } },
      select,
    });
  }
  // A new child sent again: same typed name, same parent phone, not yet on
  // the roster. Matched in code because the name is compared normalised.
  const candidates = await tx.registration.findMany({
    where: { formId, participantId: null, parentPhone: key.parentPhone, status: { not: "rejected" } },
    select,
  });
  const name = normalizeName(key.newChild);
  return candidates.find((c) => normalizeName(c.childName ?? "") === name) ?? null;
}

// ── The adult's side ────────────────────────────────────────────────────────

export type ReviewAction = {
  action: "approve" | "reject";
  /** Apply "goes home alone" and a new pickup person to the child's record. */
  applyChanges: boolean;
  /** Replace the phone on file with the one in the submission. */
  applyContact: boolean;
};

/**
 * An adult decides on a registration.
 *
 * Approving does what the submission could not do on its own: puts a new
 * child on the roster (or onto the existing record, when the typed name and
 * the parent's phone match one), and — only if the adult ticks it — changes
 * who may collect the child. The default is to change nothing about going
 * home; the adult has to choose to.
 */
export async function reviewRegistration(
  id: string,
  { action, applyChanges, applyContact }: ReviewAction,
  userId: string,
): Promise<{ status: string; participantId: string | null }> {
  return prisma.$transaction(
    async (tx) => {
      const head = await tx.registration.findFirst({
        where: { id, form: { event: LIVE_EVENT } },
        select: { formId: true },
      });
      if (!head) throw new RegistrationError("ההרשמה לא נמצאה", 404);
      await lockForm(tx, head.formId);

      const reg = await tx.registration.findUniqueOrThrow({
        where: { id },
        include: {
          days: true,
          form: { select: { id: true, eventId: true, capacity: true } },
          participant: { select: { id: true, deletedAt: true } },
        },
      });
      if (reg.participant?.deletedAt) throw new RegistrationError("ההרשמה לא נמצאה", 404);
      const reviewed = { reviewedAt: new Date(), reviewedByUserId: userId };

      if (action === "reject") {
        if (reg.status === "approved" && reg.participantId) {
          // In an event that counts by registration, no row is "not
          // expected" — the answers were only ever this registration's.
          await tx.expectedAttendance.deleteMany({
            where: {
              participantId: reg.participantId,
              eventDayId: { in: reg.days.map((d) => d.eventDayId) },
            },
          });
        }
        await tx.registration.update({
          where: { id },
          data: { status: "rejected", ...reviewed },
        });
        return { status: "rejected", participantId: reg.participantId };
      }

      const coming = reg.days.some((d) => d.coming);
      if (reg.status !== "approved" && coming && reg.form.capacity !== null) {
        const taken = await countPlaces(tx, reg.form.id, reg.id);
        if (taken >= reg.form.capacity) {
          throw new RegistrationError(
            "המכסה מלאה. אפשר להגדיל את המכסה בהגדרות, או לחכות שיתפנה מקום.",
            409,
          );
        }
      }

      const reasons = reg.reviewReasons as ReviewReason[];
      let participantId = reg.participantId;

      if (!participantId) {
        // A new child. The typed name and the parent's phone are the same key
        // the roster import matches on: a child who was at the last camp must
        // not be created twice.
        const name = normalizeName(reg.childName ?? "");
        const candidates = await tx.participant.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, parentPhone: true },
        });
        const match = candidates.find(
          (c) =>
            normalizeName(c.name) === name &&
            c.parentPhone !== null &&
            normalizePhone(c.parentPhone) === reg.parentPhone,
        );
        if (match) {
          const clash = await tx.registration.findUnique({
            where: { formId_participantId: { formId: reg.formId, participantId: match.id } },
            select: { id: true },
          });
          if (clash) {
            throw new RegistrationError(
              `${match.name} כבר רשום/ה לאירוע הזה בהרשמה אחרת — כנראה אותו/ה ילד/ה. אפשר לדחות את הכפולה.`,
              409,
            );
          }
          participantId = match.id;
        } else {
          // Contact details go onto the record here, and only here: this is
          // a new child, and an adult has just looked at who sent them.
          const created = await tx.participant.create({
            data: {
              name: reg.childName ?? "",
              grade: reg.childGrade,
              parentName: reg.parentName,
              parentPhone: reg.parentPhone,
              defaultDismissal: applyChanges && reg.dismissal === "alone" ? "alone" : "escort",
            },
            select: { id: true },
          });
          participantId = created.id;
        }
      }

      if (applyChanges) {
        if (reasons.includes("dismissal_alone") && reg.dismissal === "alone") {
          await tx.participant.update({
            where: { id: participantId },
            data: { defaultDismissal: "alone" },
          });
        }
        if (reg.pickupName && reg.pickupPhone) {
          const pickup = { name: reg.pickupName, phone: reg.pickupPhone };
          const auths = await tx.pickupAuthorization.findMany({
            where: { participantId },
            select: { name: true, phone: true },
          });
          if (!auths.some((a) => isSameAuthorization(a, pickup))) {
            await tx.pickupAuthorization.create({
              data: { participantId, ...pickup, relation: reg.pickupRelation },
            });
          }
        }
      }

      if (applyContact && reasons.includes("contact_differs")) {
        await tx.participant.update({
          where: { id: participantId },
          data: { parentName: reg.parentName, parentPhone: reg.parentPhone },
        });
      }

      await writeExpected(
        tx,
        participantId,
        reg.form.eventId,
        reg.days.map((d) => ({
          eventDayId: d.eventDayId,
          coming: d.coming,
          bringsFood: d.bringsFood,
        })),
      );
      await tx.registration.update({
        where: { id },
        data: { status: "approved", participantId, ...reviewed },
      });
      return { status: "approved", participantId };
    },
    { timeout: 20000 },
  );
}

// ── The staff screen's data ─────────────────────────────────────────────────

export type StaffRegistration = {
  id: string;
  childName: string;
  childGrade: string | null;
  isNew: boolean;
  parentName: string;
  parentPhone: string;
  dismissal: string;
  pickupName: string | null;
  pickupRelation: string | null;
  pickupPhone: string | null;
  note: string | null;
  status: string;
  reviewReasons: string[];
  needsReview: boolean;
  revision: number;
  submittedAt: string;
  createdAt: string;
  days: { eventDayId: string; coming: boolean; bringsFood: boolean | null }[];
  /** What is on file now, for the "this is a change" comparison. Only with roster:contacts for the phone. */
  stored: {
    defaultDismissal: string;
    parentPhone: string | null;
    authorizations: { name: string; phone: string | null; relation: string | null }[];
  } | null;
};

export async function staffRegistrations(
  formId: string,
  { withContacts }: { withContacts: boolean },
): Promise<StaffRegistration[]> {
  const rows = await prisma.registration.findMany({
    where: {
      formId,
      // A registration whose child was deleted since is gone with the child.
      OR: [{ participantId: null }, { participant: { deletedAt: null } }],
    },
    orderBy: { createdAt: "asc" },
    include: {
      days: { select: { eventDayId: true, coming: true, bringsFood: true } },
      participant: {
        select: {
          name: true,
          grade: true,
          defaultDismissal: true,
          parentPhone: withContacts,
          pickupAuth: { select: { name: true, phone: true, relation: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    childName: r.participant?.name ?? r.childName ?? "",
    childGrade: r.participant?.grade ?? r.childGrade,
    isNew: r.reviewReasons.includes("new_child"),
    parentName: r.parentName,
    parentPhone: withContacts ? r.parentPhone : "",
    dismissal: r.dismissal,
    pickupName: r.pickupName,
    pickupRelation: r.pickupRelation,
    pickupPhone: withContacts ? r.pickupPhone : null,
    note: r.note,
    status: r.status,
    reviewReasons: r.reviewReasons,
    needsReview:
      r.status === "pending" || (r.reviewReasons.length > 0 && r.reviewedAt === null),
    revision: r.revision,
    submittedAt: r.submittedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    days: r.days,
    stored: r.participant
      ? {
          defaultDismissal: r.participant.defaultDismissal,
          parentPhone: withContacts ? (r.participant.parentPhone ?? null) : null,
          authorizations: r.participant.pickupAuth.map((a) => ({
            name: a.name,
            phone: withContacts ? a.phone : null,
            relation: a.relation,
          })),
        }
      : null,
  }));
}


/** For a route's catch: a RegistrationError becomes its own answer, anything else is not ours. */
export function registrationErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof RegistrationError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}
