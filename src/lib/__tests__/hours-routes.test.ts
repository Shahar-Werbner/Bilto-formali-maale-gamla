import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, capabilitiesOf, type Capability, type Role } from "../roles";

// Route-level tests for the monthly hours report, in the shape the dismissal,
// day-group and shift routes are tested in: Prisma and the auth guard are
// mocked, the capability table is the real one.
//
// What a pure test cannot see and this can: that a youth counselor is sent
// their own month and nobody else's, that a malformed month is refused rather
// than silently answered for a different one, and that the .xlsx is scoped the
// same way the screen is.

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
  userId: string;
  startTime: string | null;
  endTime: string | null;
  role: string | null;
  note: string | null;
  user: { name: string; role: string };
  eventDay: {
    date: Date;
    startTime: string | null;
    endTime: string | null;
    event: { name: string };
  };
};

function shift(over: Partial<ShiftRow> & { userId: string; name: string }): ShiftRow {
  return {
    userId: over.userId,
    startTime: over.startTime ?? null,
    endTime: over.endTime ?? null,
    role: over.role ?? null,
    note: over.note ?? null,
    user: { name: over.name, role: over.user?.role ?? "youth" },
    eventDay: over.eventDay ?? {
      date: new Date("2026-09-01T00:00:00.000Z"),
      startTime: "16:00",
      endTime: "19:00",
      event: { name: "שנת פעילות" },
    },
  };
}

let shifts: ShiftRow[];
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shift: {
      findMany: (args: {
        where: { userId?: string; eventDay?: Record<string, unknown> };
      }) => {
        findMany(args);
        return Promise.resolve(
          args.where.userId
            ? shifts.filter((s) => s.userId === args.where.userId)
            : shifts,
        );
      },
    },
  },
}));

const { GET } = await import("@/app/api/reports/hours/route");
const { GET: EXPORT } = await import("@/app/api/reports/hours/export/route");

function request(query = ""): Request {
  return new Request(`http://localhost/api/reports/hours${query}`);
}

beforeEach(() => {
  role = "staff";
  findMany.mockClear();
  shifts = [
    shift({ userId: ME, name: "אבי", user: { name: "אבי", role: "staff" } }),
    shift({ userId: "u-other", name: "תמר" }),
  ];
});

describe("GET /api/reports/hours", () => {
  it("sums the month for the whole team when you may see it", async () => {
    const res = await GET(request("?month=2026-09"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.month).toBe("2026-09");
    expect(body.people.map((p: { name: string }) => p.name)).toEqual([
      "אבי",
      "תמר",
    ]);
    expect(body.totalHours).toBe(6);
    expect(body.canViewAll).toBe(true);
  });

  it("sends a youth counselor their own month and nobody else's", async () => {
    role = "youth";
    const res = await GET(request("?month=2026-09"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Not merely hidden on the screen: the other person's hours never leave
    // the server. A youth counselor is typically 15, on their own phone.
    expect(body.people).toHaveLength(1);
    expect(body.people[0].name).toBe("אבי");
    expect(body.canViewAll).toBe(false);
    expect(JSON.stringify(body)).not.toContain("תמר");
    expect(findMany.mock.calls[0][0].where.userId).toBe(ME);
  });

  it("scopes the query to live events and to the month asked for", async () => {
    await GET(request("?month=2026-09"));
    const where = findMany.mock.calls[0][0].where;
    // Invariant 1: a deleted event must not pay anyone for a session the rest
    // of the system says never happened.
    expect(where.eventDay.event).toEqual({ deletedAt: null });
    expect(where.eventDay.date.gte.toISOString().slice(0, 10)).toBe(
      "2026-09-01",
    );
    expect(where.eventDay.date.lte.toISOString().slice(0, 10)).toBe(
      "2026-09-30",
    );
  });

  it("refuses a malformed month rather than answering for another one", async () => {
    const res = await GET(request("?month=2026-13"));
    expect(res.status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("defaults to this month when none is asked for", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("carries the per-day detail a disputed number is checked against", async () => {
    shifts = [
      shift({
        userId: ME,
        name: "אבי",
        user: { name: "אבי", role: "staff" },
        startTime: "17:00",
        role: "אחראי/ת",
      }),
    ];
    const body = await (await GET(request("?month=2026-09"))).json();
    const [day] = body.people[0].days;
    expect(day.eventName).toBe("שנת פעילות");
    expect(day.date).toBe("2026-09-01");
    expect(day.overridden).toBe(true);
    expect(day.hours).toBe(2);
    expect(day.role).toBe("אחראי/ת");
  });
});

describe("GET /api/reports/hours/export", () => {
  it("returns an .xlsx with the Hebrew filename encoded", async () => {
    const res = await EXPORT(request("/export?month=2026-09"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(res.headers.get("Content-Disposition")).toContain("staff-hours-2026-09");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("scopes the file exactly as the screen is scoped", async () => {
    role = "youth";
    await EXPORT(request("/export?month=2026-09"));
    expect(findMany.mock.calls[0][0].where.userId).toBe(ME);
  });

  it("refuses a malformed month", async () => {
    const res = await EXPORT(request("/export?month=nope"));
    expect(res.status).toBe(400);
  });

  it("still produces a file for a month with no shifts in it", async () => {
    // An empty month is a normal answer (August), not an error — and ExcelJS
    // throwing on an empty sheet would turn it into a 500.
    shifts = [];
    const res = await EXPORT(request("/export?month=2026-08"));
    expect(res.status).toBe(200);
  });
});
