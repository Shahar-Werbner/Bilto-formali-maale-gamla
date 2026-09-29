import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, type Capability, type Role } from "../roles";
import { todayDateOnly } from "../attendance";

// Route-level tests for the rating endpoint — the step that turns the bank
// from a list into a ranking. What matters is the boundary: who may rate,
// which slots may be rated, and that a second tap changes the vote rather
// than adding one.

let role: Role = "youth";
const ME = "u-me";

vi.mock("@/lib/api-auth", () => ({
  requireCapability: async (capability: Capability) =>
    can(role, capability)
      ? { session: { user: { id: ME } }, response: null }
      : {
          session: null,
          response: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }),
        },
}));

type SlotFixture = {
  id: string;
  status: string;
  activityId: string | null;
  activity: { id: string } | null;
  eventDay: { date: Date };
} | null;

let slot: SlotFixture;
let existing: { verdict: string } | null = null;
const upsert = vi.fn();
const findSlot = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activitySlot: {
      findFirst: (args: unknown) => {
        findSlot(args);
        return Promise.resolve(slot);
      },
    },
    activityRating: {
      findUnique: () => Promise.resolve(existing),
      upsert: (args: { create: { verdict: string; note: string | null } }) => {
        upsert(args);
        return Promise.resolve({ verdict: args.create.verdict, note: args.create.note });
      },
    },
  },
}));

const { POST: RATE } = await import("@/app/api/activity-slots/[id]/rate/route");

function rate(body: unknown) {
  return RATE(
    new Request("http://localhost/api/activity-slots/s1/rate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: { id: "s1" } },
  );
}

const day = (offset: number) => {
  const d = new Date(`${todayDateOnly()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

beforeEach(() => {
  role = "youth";
  existing = null;
  upsert.mockClear();
  findSlot.mockClear();
  slot = {
    id: "s1",
    status: "approved",
    activityId: "a1",
    activity: { id: "a1" },
    eventDay: { date: day(0) },
  };
});

describe("POST /api/activity-slots/:id/rate", () => {
  it("lets a youth counselor rate the activity they ran today", async () => {
    const res = await rate({ verdict: "worked" });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("keys the vote on (slot, person), so a second tap changes it", async () => {
    await rate({ verdict: "flopped", note: "ירד גשם" });
    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      activitySlotId_userId: { activitySlotId: "s1", userId: ME },
    });
    expect(args.update).toEqual({ verdict: "flopped", note: "ירד גשם" });
  });

  it("keeps the note when the same verdict is tapped again without words", async () => {
    existing = { verdict: "flopped" };
    await rate({ verdict: "flopped" });
    expect(upsert.mock.calls[0][0].update).toEqual({ verdict: "flopped" });
  });

  it("drops a note written for another verdict when the vote changes", async () => {
    // "Too dark for grade א" must not end up under a thumbs-up.
    existing = { verdict: "flopped" };
    await rate({ verdict: "worked" });
    expect(upsert.mock.calls[0][0].update).toEqual({ verdict: "worked", note: null });
  });

  it("scopes the slot to a live event", async () => {
    await rate({ verdict: "worked" });
    expect(findSlot.mock.calls[0][0].where).toEqual({
      id: "s1",
      eventDay: { event: { deletedAt: null } },
    });
  });

  it("refuses an unknown verdict", async () => {
    expect((await rate({ verdict: "great" })).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("answers 404 for a slot that is gone or whose event was deleted", async () => {
    slot = null;
    expect((await rate({ verdict: "worked" })).status).toBe(404);
  });

  it.each([
    ["a day that has not come yet", { eventDay: { date: day(1) } }],
    ["a proposal nobody approved", { status: "pending" }],
    ["a slot that is not from the bank", { activityId: null, activity: null }],
  ])("refuses %s", async (_why, patch) => {
    slot = { ...(slot as NonNullable<SlotFixture>), ...patch };
    expect((await rate({ verdict: "worked" })).status).toBe(409);
    expect(upsert).not.toHaveBeenCalled();
  });
});
