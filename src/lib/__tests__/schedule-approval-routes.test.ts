import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, capabilitiesOf, type Capability, type Role } from "../roles";

// Route-level tests for the approval loop: a youth counselor plans the
// activity they run, an adult signs it off.
//
// The interesting part is not the happy path but the boundary — what a
// proposal lands as, what a proposer may and may not touch afterwards, and
// that approving writes all three columns rather than only the status.

let role: Role = "youth";
const ME = "u-me";

vi.mock("@/lib/api-auth", () => ({
  requireCapability: async (capability: Capability) => {
    if (!can(role, capability)) {
      return {
        session: null,
        response: NextResponse.json(
          { error: "אין לך הרשאה לפעולה הזו" },
          { status: 403 },
        ),
      };
    }
    return { session: { user: { id: ME } }, response: null };
  },
  sessionCan: async (capability: Capability) => can(role, capability),
  sessionCapabilities: async () => capabilitiesOf(role),
}));

type Fixture = {
  /** null = the day is gone, or its event was soft-deleted. */
  day: { id: string } | null;
  /** null = the slot is gone, or its day's event was soft-deleted. */
  slot: { id: string; status: string } | null;
  deleted: number;
};

let fixture: Fixture;
const create = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventDay: { findFirst: () => Promise.resolve(fixture.day) },
    group: { findFirst: () => Promise.resolve({ id: "g1", name: "האריות" }) },
    activitySlot: {
      findFirst: (args: { orderBy?: unknown }) =>
        // The create route asks for the last `order`; everything else asks for
        // the slot itself.
        Promise.resolve(args?.orderBy ? { order: 2 } : fixture.slot),
      create: (args: { data: Record<string, unknown> }) => {
        create(args);
        return Promise.resolve({ id: "slot-new", ...args.data, group: null });
      },
      update: (args: { data: Record<string, unknown> }) => {
        update(args);
        return Promise.resolve({ id: fixture.slot?.id, ...args.data, group: null });
      },
      deleteMany: (args: unknown) => {
        deleteMany(args);
        return Promise.resolve({ count: fixture.deleted });
      },
    },
  },
}));

const { POST: CREATE } = await import(
  "@/app/api/event-days/[id]/activity-slots/route"
);
const { PATCH, DELETE } = await import("@/app/api/activity-slots/[id]/route");
const { POST: DECIDE } = await import(
  "@/app/api/activity-slots/[id]/approve/route"
);

function createSlot(body: Record<string, unknown>) {
  return CREATE(
    new Request("http://localhost/api/event-days/d1/activity-slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id: "d1" } },
  );
}

function patchSlot(body: Record<string, unknown>) {
  return PATCH(
    new Request("http://localhost/api/activity-slots/slot-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id: "slot-1" } },
  );
}

function deleteSlot() {
  return DELETE(
    new Request("http://localhost/api/activity-slots/slot-1", { method: "DELETE" }),
    { params: { id: "slot-1" } },
  );
}

function decide(body: Record<string, unknown>) {
  return DECIDE(
    new Request("http://localhost/api/activity-slots/slot-1/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id: "slot-1" } },
  );
}

beforeEach(() => {
  role = "youth";
  fixture = { day: { id: "d1" }, slot: { id: "slot-1", status: "pending" }, deleted: 1 };
  create.mockClear();
  update.mockClear();
  deleteMany.mockClear();
});

describe("proposing a slot", () => {
  it("writes a youth counselor's plan as waiting for approval", async () => {
    const res = await createSlot({ startTime: "10:00", title: "ריקוד" });
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "ריקוד", status: "pending" }),
      }),
    );
  });

  it("writes an adult's slot straight into the day", async () => {
    // The column's default is "approved" for exactly this reason: someone who
    // may edit the schedule approves it by writing it.
    role = "staff";
    await createSlot({ startTime: "10:00", title: "ריקוד" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "approved" }) }),
    );
  });

  it("writes an admin's slot straight into the day as well", async () => {
    role = "admin";
    expect((await createSlot({ startTime: "10:00", title: "x" })).status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "approved" }) }),
    );
  });

  it("answers 404 for a day whose event was deleted", async () => {
    fixture.day = null;
    expect((await createSlot({ startTime: "10:00", title: "x" })).status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("changing a slot", () => {
  it("lets a proposer fix their own waiting plan", async () => {
    const res = await patchSlot({ title: "ריקוד סלואו" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "ריקוד סלואו", status: "pending" }),
      }),
    );
  });

  it("puts a slot that was sent back for a fix into the queue again", async () => {
    fixture.slot = { id: "slot-1", status: "draft" };
    await patchSlot({ title: "ריקוד, גרסה ב" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "pending" }) }),
    );
  });

  it("refuses a proposer an approved slot", async () => {
    fixture.slot = { id: "slot-1", status: "approved" };
    const res = await patchSlot({ title: "משהו אחר" });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("lets an adult edit an approved slot without changing its status", async () => {
    role = "staff";
    fixture.slot = { id: "slot-1", status: "approved" };
    await patchSlot({ title: "ריקוד" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "approved" }) }),
    );
  });

  it("does not turn an adult's edit of a pending slot into an approval", async () => {
    // Approving is its own act, with a name and a time against it.
    role = "staff";
    await patchSlot({ title: "ריקוד" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "pending" }) }),
    );
  });

  it("answers 404 for a slot whose event was deleted", async () => {
    fixture.slot = null;
    expect((await patchSlot({ title: "x" })).status).toBe(404);
  });
});

describe("deleting a slot", () => {
  it("lets a proposer withdraw a plan that is not part of the day yet", async () => {
    expect((await deleteSlot()).status).toBe(200);
    expect(deleteMany).toHaveBeenCalled();
  });

  it("refuses a proposer an approved slot", async () => {
    fixture.slot = { id: "slot-1", status: "approved" };
    expect((await deleteSlot()).status).toBe(403);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("lets an adult delete anything on a live event", async () => {
    role = "staff";
    fixture.slot = { id: "slot-1", status: "approved" };
    expect((await deleteSlot()).status).toBe(200);
  });
});

describe("approving a slot", () => {
  it("refuses a youth counselor — approving your own plan is no loop at all", async () => {
    const res = await decide({ approve: true });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes the status, the approver and the time together", async () => {
    // A slot that reads "approved" with no name and no time against it is a
    // plan nobody can be asked about afterwards.
    role = "staff";
    const res = await decide({ approve: true });
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe("approved");
    expect(data.approvedByUserId).toBe(ME);
    expect(data.approvedAt).toBeInstanceOf(Date);
  });

  it("approves by default, so a body-less request cannot mean 'reject'", async () => {
    role = "staff";
    await decide({});
    expect(update.mock.calls[0][0].data.status).toBe("approved");
  });

  it("sends one back for a fix, clearing the approval columns", async () => {
    role = "staff";
    await decide({ approve: false });
    expect(update.mock.calls[0][0].data).toEqual({
      status: "draft",
      approvedByUserId: null,
      approvedAt: null,
    });
  });

  it("answers 404 for a slot whose event was deleted", async () => {
    role = "staff";
    fixture.slot = null;
    expect((await decide({ approve: true })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});
