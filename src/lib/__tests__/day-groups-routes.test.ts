import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, capabilitiesOf, type Capability, type Role } from "../roles";

// Route-level tests for the per-session split, in the shape the dismissal
// routes are tested in: Prisma and the auth guard are mocked, the capability
// table is the real one.
//
// What is checked here is what a pure test cannot see — who may change a
// split, that a deleted event or group is treated as gone, and that placing a
// child for one Tuesday never writes to their standing membership.

let role: Role = "staff";

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
    return { session: { user: { id: "u1" } }, response: null };
  },
  sessionCapabilities: async () => capabilitiesOf(role),
}));

type Group = { id: string; name: string; deletedAt: Date | null };
type Assignment = { participantId: string; groupId: string };

type Fixture = {
  /** null = the day is gone, or the child is not on this event. */
  day: {
    id: string;
    date: Date;
    eventId: string;
    event: {
      participants: Array<{
        id: string;
        name: string;
        grade: string | null;
        groups: Array<{ id: string }>;
      }>;
    };
  } | null;
  previousDay: { id: string; date: Date; groupAssignments: Assignment[] } | null;
  groups: Group[];
  assignments: Assignment[];
  /** How many rows a delete removed. */
  deleted: number;
};

let fixture: Fixture;
const upsert = vi.fn();
const createMany = vi.fn();
const deleteMany = vi.fn();
const participantUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventDay: {
      // The only two shapes the routes ask for: "this day" and "the most
      // recent earlier day of the same event that was split".
      findFirst: (args: { where?: { date?: unknown } }) =>
        Promise.resolve(args?.where?.date ? fixture.previousDay : fixture.day),
    },
    group: {
      findMany: () =>
        Promise.resolve(
          fixture.groups
            .filter((g) => !g.deletedAt)
            .map(({ id, name }) => ({ id, name })),
        ),
      findFirst: (args: { where: { id: string } }) =>
        Promise.resolve(
          fixture.groups.find((g) => g.id === args.where.id && !g.deletedAt) ??
            null,
        ),
    },
    dayGroupAssignment: {
      findMany: () =>
        Promise.resolve(
          fixture.assignments.map((a) => ({
            ...a,
            group: fixture.groups.find((g) => g.id === a.groupId),
          })),
        ),
      upsert: (args: unknown) => {
        upsert(args);
        return Promise.resolve({});
      },
      createMany: (args: { data: unknown[] }) => {
        createMany(args);
        return Promise.resolve({ count: args.data.length });
      },
      deleteMany: (args: unknown) => {
        deleteMany(args);
        return Promise.resolve({ count: fixture.deleted });
      },
    },
    // Present so a route that reached for it would be visible here rather than
    // silently succeeding: nothing in these routes may write to the roster.
    participant: { update: participantUpdate, findFirst: () => Promise.resolve(null) },
  },
}));

const { GET, POST, DELETE } = await import("@/app/api/day-groups/route");
const { POST: PREFILL } = await import("@/app/api/day-groups/prefill/route");

function get(query: string) {
  return GET(new Request(`http://localhost/api/day-groups?${query}`));
}

function post(url: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function prefill(body: Record<string, unknown>) {
  return PREFILL(
    new Request("http://localhost/api/day-groups/prefill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  role = "staff";
  fixture = {
    day: {
      id: "d1",
      date: new Date("2026-09-22T00:00:00.000Z"),
      eventId: "e1",
      event: {
        participants: [
          { id: "p1", name: "יעל", grade: "א'", groups: [{ id: "g-lions" }] },
          { id: "p2", name: "נועם", grade: "ב'", groups: [] },
        ],
      },
    },
    previousDay: null,
    groups: [
      { id: "g-lions", name: "האריות", deletedAt: null },
      { id: "g-tigers", name: "הנמרים", deletedAt: null },
    ],
    assignments: [],
    deleted: 1,
  };
  upsert.mockClear();
  createMany.mockClear();
  deleteMany.mockClear();
  participantUpdate.mockClear();
});

describe("GET /api/day-groups", () => {
  it("lets a youth counselor read the day's split", async () => {
    role = "youth";
    const res = await get("eventDayId=d1");
    expect(res.status).toBe(200);
  });

  it("shows a day nobody has split as everyone unassigned", async () => {
    const res = await get("eventDayId=d1");
    const data = await res.json();
    // Not "everyone in their standing group" — יעל is in האריות all year and
    // still comes back with no group for this day.
    expect(data.children).toEqual([
      { participantId: "p1", name: "יעל", grade: "א'", groupId: null },
      { participantId: "p2", name: "נועם", grade: "ב'", groupId: null },
    ]);
  });

  it("answers 404 for a day whose event was deleted", async () => {
    fixture.day = null;
    const res = await get("eventDayId=d1");
    expect(res.status).toBe(404);
  });

  it("still names a group that was deleted after the day was split", async () => {
    // Otherwise the past session would show part of its children with no
    // group at all — the failure that made Group soft-deleted.
    fixture.groups.push({ id: "g-old", name: "הדובים", deletedAt: new Date() });
    fixture.assignments = [{ participantId: "p1", groupId: "g-old" }];
    const res = await get("eventDayId=d1");
    const data = await res.json();
    expect(data.groups).toContainEqual({
      id: "g-old",
      name: "הדובים",
      deleted: true,
    });
    expect(data.children[0]).toMatchObject({ participantId: "p1", groupId: "g-old" });
  });
});

describe("POST /api/day-groups — placing one child for one day", () => {
  it("refuses a youth counselor", async () => {
    // Marking who turned up is their job; deciding the split is not.
    role = "youth";
    const res = await post("/api/day-groups", {
      eventDayId: "d1",
      participantId: "p1",
      groupId: "g-lions",
    });
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("places a child on the day's unique (day, child) row", async () => {
    const res = await post("/api/day-groups", {
      eventDayId: "d1",
      participantId: "p1",
      groupId: "g-tigers",
    });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventDayId_participantId: { eventDayId: "d1", participantId: "p1" } },
        update: { groupId: "g-tigers" },
      }),
    );
  });

  it("does not touch the child's standing membership", async () => {
    // "יעל was in the Tigers this Tuesday" must not move her out of the Lions
    // for the year. The two are separate on purpose.
    await post("/api/day-groups", {
      eventDayId: "d1",
      participantId: "p1",
      groupId: "g-tigers",
    });
    expect(participantUpdate).not.toHaveBeenCalled();
  });

  it("answers 404 when the child is not on this event", async () => {
    fixture.day = null;
    const res = await post("/api/day-groups", {
      eventDayId: "d1",
      participantId: "p9",
      groupId: "g-lions",
    });
    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a group that has been deleted", async () => {
    fixture.groups.push({ id: "g-old", name: "הדובים", deletedAt: new Date() });
    const res = await post("/api/day-groups", {
      eventDayId: "d1",
      participantId: "p1",
      groupId: "g-old",
    });
    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/day-groups", () => {
  it("refuses a youth counselor", async () => {
    role = "youth";
    const res = await DELETE(
      new Request("http://localhost/api/day-groups?eventDayId=d1&participantId=p1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(403);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("scopes the clear to a live event", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/day-groups?eventDayId=d1&all=1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { eventDayId: "d1", eventDay: { event: { deletedAt: null } } },
    });
  });

  it("answers 404 when the child had no group for this day", async () => {
    fixture.deleted = 0;
    const res = await DELETE(
      new Request("http://localhost/api/day-groups?eventDayId=d1&participantId=p1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("does not treat clearing an unsplit day as an error", async () => {
    fixture.deleted = 0;
    const res = await DELETE(
      new Request("http://localhost/api/day-groups?eventDayId=d1&all=1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/day-groups/prefill", () => {
  it("refuses a youth counselor", async () => {
    role = "youth";
    const res = await prefill({ eventDayId: "d1", source: "standing" });
    expect(res.status).toBe(403);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("rejects a source it does not know", async () => {
    const res = await prefill({ eventDayId: "d1", source: "vibes" });
    expect(res.status).toBe(400);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("fills from the standing membership and leaves the rest unassigned", async () => {
    const res = await prefill({ eventDayId: "d1", source: "standing" });
    await expect(res.json()).resolves.toMatchObject({
      filled: 1,
      kept: 0,
      unmatched: 1,
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ eventDayId: "d1", participantId: "p1", groupId: "g-lions" }],
      skipDuplicates: true,
    });
  });

  it("keeps a child the day already placed", async () => {
    fixture.assignments = [{ participantId: "p1", groupId: "g-tigers" }];
    const res = await prefill({ eventDayId: "d1", source: "standing" });
    await expect(res.json()).resolves.toMatchObject({ filled: 0, kept: 1 });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("copies the previous session and names the day it copied", async () => {
    fixture.previousDay = {
      id: "d0",
      date: new Date("2026-09-18T00:00:00.000Z"),
      groupAssignments: [{ participantId: "p2", groupId: "g-tigers" }],
    };
    const res = await prefill({ eventDayId: "d1", source: "previous" });
    await expect(res.json()).resolves.toMatchObject({
      filled: 1,
      // p1 was not at that session, so there is nothing to copy for them.
      unmatched: 1,
      previousDay: { id: "d0", date: "2026-09-18" },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ eventDayId: "d1", participantId: "p2", groupId: "g-tigers" }],
      skipDuplicates: true,
    });
  });

  it("answers 404 for a day whose event was deleted", async () => {
    fixture.day = null;
    const res = await prefill({ eventDayId: "d1", source: "grade" });
    expect(res.status).toBe(404);
    expect(createMany).not.toHaveBeenCalled();
  });
});
