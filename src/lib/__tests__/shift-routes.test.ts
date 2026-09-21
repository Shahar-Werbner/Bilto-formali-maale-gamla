import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, capabilitiesOf, type Capability, type Role } from "../roles";

// Route-level tests for the staff roster, in the shape the dismissal and
// day-group routes are tested in: Prisma and the auth guard are mocked, the
// capability table is the real one.
//
// What a pure test cannot see, and this can: who may assign, what a youth
// counselor is actually sent back, and that a deleted event is gone.

let role: Role = "staff";
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

type ShiftRow = {
  id: string;
  userId: string;
  startTime: string | null;
  endTime: string | null;
  role: string | null;
  note: string | null;
  user: { name: string; role: string };
};

type Fixture = {
  /** null = the day is gone, or its event was soft-deleted. */
  day: {
    id: string;
    startTime: string | null;
    endTime: string | null;
    event: {
      id: string;
      maxChildrenPerStaff: number | null;
      _count: { participants: number };
    };
  } | null;
  shifts: ShiftRow[];
  users: Array<{ id: string; name: string; role: string }>;
  /** Attendance rows for the day: [marked in total, present or late]. */
  attendance: [number, number];
  /** Parents' answers for the day (item 5): [not coming, answered at all]. */
  expected: [number, number];
  deleted: number;
};

let fixture: Fixture;
const upsert = vi.fn();
const deleteMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventDay: { findFirst: () => Promise.resolve(fixture.day) },
    shift: {
      findMany: (args: { where: { userId?: string } }) =>
        Promise.resolve(
          args.where.userId
            ? fixture.shifts.filter((s) => s.userId === args.where.userId)
            : fixture.shifts,
        ),
      upsert: (args: {
        where: { userId_eventDayId: { userId: string; eventDayId: string } };
        create: Record<string, unknown>;
      }) => {
        upsert(args);
        return Promise.resolve({
          id: "s-new",
          userId: args.where.userId_eventDayId.userId,
          startTime: args.create.startTime ?? null,
          endTime: args.create.endTime ?? null,
          role: args.create.role ?? null,
          note: args.create.note ?? null,
        });
      },
      deleteMany: (args: unknown) => {
        deleteMany(args);
        return Promise.resolve({ count: fixture.deleted });
      },
    },
    eventAttendance: {
      count: (args: { where: { status?: unknown } }) =>
        Promise.resolve(args.where.status ? fixture.attendance[1] : fixture.attendance[0]),
    },
    expectedAttendance: {
      count: (args: { where: { coming?: unknown } }) =>
        Promise.resolve(
          args.where.coming === false ? fixture.expected[0] : fixture.expected[1],
        ),
    },
    user: {
      findMany: () => Promise.resolve(fixture.users),
      findUnique: (args: { where: { id: string } }) =>
        Promise.resolve(fixture.users.find((u) => u.id === args.where.id) ?? null),
    },
  },
}));

const { GET, POST, DELETE } = await import("@/app/api/shifts/route");

function get(query: string) {
  return GET(new Request(`http://localhost/api/shifts?${query}`));
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function del(query: string) {
  return DELETE(
    new Request(`http://localhost/api/shifts?${query}`, { method: "DELETE" }),
  );
}

beforeEach(() => {
  role = "staff";
  fixture = {
    day: {
      id: "d1",
      startTime: "16:00",
      endTime: "19:00",
      event: { id: "e1", maxChildrenPerStaff: null, _count: { participants: 40 } },
    },
    shifts: [
      {
        id: "s1",
        userId: "u-adult",
        startTime: null,
        endTime: null,
        role: null,
        note: null,
        user: { name: "רותם", role: "staff" },
      },
      {
        id: "s2",
        userId: ME,
        startTime: "17:00",
        endTime: null,
        role: "מדריך קבוצה",
        note: null,
        user: { name: "איתי", role: "youth" },
      },
    ],
    users: [
      { id: "u-adult", name: "רותם", role: "staff" },
      { id: ME, name: "איתי", role: "youth" },
      { id: "u-free", name: "דנה", role: "youth" },
    ],
    attendance: [0, 0],
    expected: [0, 0],
    deleted: 1,
  };
  upsert.mockClear();
  deleteMany.mockClear();
});

describe("GET /api/shifts", () => {
  it("gives an adult the whole day's roster", async () => {
    const res = await get("eventDayId=d1");
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.shifts.map((s: { name: string }) => s.name)).toEqual([
      "רותם",
      "איתי",
    ]);
  });

  it("fills a shift's hours from the session, and keeps an override", async () => {
    const data = await (await get("eventDayId=d1")).json();
    expect(data.shifts[0]).toMatchObject({
      startTime: "16:00",
      endTime: "19:00",
      hours: 3,
      overridden: false,
    });
    expect(data.shifts[1]).toMatchObject({
      startTime: "17:00",
      endTime: "19:00",
      hours: 2,
      overridden: true,
    });
  });

  it("sends a youth counselor their own shift and nobody else's", async () => {
    // Field-level, not screen-level: who else is working and how short the day
    // is never leaves the server. Data that is not sent cannot leak.
    role = "youth";
    const data = await (await get("eventDayId=d1")).json();
    expect(data.shifts).toHaveLength(1);
    expect(data.shifts[0].userId).toBe(ME);
    expect(data.ratio).toBeNull();
    expect(data.candidates).toEqual([]);
  });

  it("offers the picker only to someone who may assign", async () => {
    const adult = await (await get("eventDayId=d1")).json();
    expect(adult.candidates).toHaveLength(3);
    // A youth counselor is a candidate like anyone else — they just cannot do
    // the assigning.
    expect(adult.candidates.map((c: { id: string }) => c.id)).toContain(ME);
  });

  it("counts the roster while the day is only partly marked", async () => {
    fixture.attendance = [5, 5];
    fixture.shifts = [fixture.shifts[0]];
    const data = await (await get("eventDayId=d1")).json();
    expect(data.ratio).toMatchObject({
      children: 40,
      childrenSource: "roster",
      level: "short",
      missingStaff: 4,
    });
  });

  it("uses the marked number once the whole day is marked", async () => {
    fixture.attendance = [40, 24];
    const data = await (await get("eventDayId=d1")).json();
    expect(data.ratio).toMatchObject({ children: 24, childrenSource: "marked" });
  });

  it("warns when the day has counselors but no adult", async () => {
    fixture.shifts = [fixture.shifts[1]]; // the youth counselor alone
    fixture.day!.event.maxChildrenPerStaff = 50;
    const data = await (await get("eventDayId=d1")).json();
    expect(data.ratio.noAdult).toBe(true);
  });

  it("answers 404 for a day whose event was deleted", async () => {
    fixture.day = null;
    expect((await get("eventDayId=d1")).status).toBe(404);
  });

  it("refuses a day id that was not sent at all", async () => {
    expect((await get("")).status).toBe(400);
  });
});

describe("POST /api/shifts", () => {
  it("refuses a youth counselor outright", async () => {
    // The owner's decision, 19.09: self-assignment would make the ratio alert
    // bypassable — an easy session filled leaves a hole in another one, and
    // the numbers still read fine.
    role = "youth";
    const res = await post({ eventDayId: "d1", userId: ME });
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("assigns someone with the session's hours by default", async () => {
    const res = await post({ eventDayId: "d1", userId: "u-free" });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "u-free",
          eventDayId: "d1",
          startTime: null,
          endTime: null,
        }),
      }),
    );
    // The row holds null; the answer holds the day's hours.
    expect(await res.json()).toMatchObject({
      startTime: "16:00",
      endTime: "19:00",
      hours: 3,
    });
  });

  it("assigning the same person twice is one shift, not two", async () => {
    await post({ eventDayId: "d1", userId: "u-adult", startTime: "17:00" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_eventDayId: { userId: "u-adult", eventDayId: "d1" } },
      }),
    );
  });

  it("refuses an inverted pair of hours", async () => {
    const res = await post({
      eventDayId: "d1",
      userId: "u-free",
      startTime: "19:00",
      endTime: "16:00",
    });
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown user instead of a foreign-key 500", async () => {
    const res = await post({ eventDayId: "d1", userId: "nobody" });
    expect(res.status).toBe(404);
  });

  it("answers 404 for a day whose event was deleted", async () => {
    fixture.day = null;
    const res = await post({ eventDayId: "d1", userId: "u-free" });
    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a body with nothing to act on", async () => {
    expect((await post({ eventDayId: "d1" })).status).toBe(400);
  });
});

describe("DELETE /api/shifts", () => {
  it("refuses a youth counselor", async () => {
    role = "youth";
    expect((await del("id=s1")).status).toBe(403);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("takes someone off the day, scoped through the day's event", async () => {
    expect((await del("id=s1")).status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "s1", eventDay: { event: { deletedAt: null } } },
    });
  });

  it("answers 404 when there was nothing to remove", async () => {
    fixture.deleted = 0;
    expect((await del("id=s1")).status).toBe(404);
  });
});
