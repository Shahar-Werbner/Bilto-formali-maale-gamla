import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, capabilitiesOf, type Capability, type Role } from "../roles";

// Route-level tests, which this repo had none of until now.
//
// Every real bug found in the last review round was in a *query* or a *guard*,
// not in a calculation — the kind neither `typecheck` nor a pure unit test can
// see. The rules this file checks are the ones that matter most in the whole
// system: who may take a six-year-old home, and who may record that they did.
//
// Prisma and the auth guard are mocked; the capability table is the real one,
// so a change to roles.ts that hands a youth counselor dismissal:authorize
// fails here rather than in the field.

// ── The signed-in user, switchable per test ─────────────────────────────────
let role: Role = "youth";

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

// ── The database, reduced to the rows a dismissal decision depends on ───────
type Fixture = {
  /** null = this child is not on this event (or the event is soft-deleted). */
  day: { id: string } | null;
  defaultDismissal: string;
  authorizations: { name: string }[];
};

let fixture: Fixture;
const upsert = vi.fn();
const deleteMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventDay: { findFirst: async () => fixture.day },
    participant: {
      findFirst: async () =>
        fixture.day
          ? {
              defaultDismissal: fixture.defaultDismissal,
              pickupAuth: fixture.authorizations,
            }
          : null,
    },
    dismissal: {
      findMany: async () => [],
      upsert: (args: unknown) => {
        upsert(args);
        return Promise.resolve({
          participantId: "p1",
          method: (args as { create: { method: string } }).create.method,
          pickedUpByName: (args as { create: { pickedUpByName: string | null } })
            .create.pickedUpByName,
          note: (args as { create: { note: string | null } }).create.note,
          at: new Date("2026-09-21T14:30:00Z"),
        });
      },
      deleteMany: (args: unknown) => {
        deleteMany(args);
        return Promise.resolve({ count: 1 });
      },
    },
  },
}));

const { POST, DELETE } = await import("@/app/api/dismissals/route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/dismissals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const MARK = {
  eventDayId: "d1",
  participantId: "p1",
};

beforeEach(() => {
  role = "youth";
  fixture = {
    day: { id: "d1" },
    defaultDismissal: "escort",
    authorizations: [{ name: "רותי כהן" }],
  };
  upsert.mockClear();
  deleteMany.mockClear();
});

describe("POST /api/dismissals — the gate", () => {
  it("lets a youth counselor record a name that is on the list", async () => {
    const res = await post({ ...MARK, method: "escort", pickedUpByName: "רותי כהן" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      method: "escort",
      pickedUpByName: "רותי כהן",
    });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("refuses a youth counselor a name that is not on the list", async () => {
    const res = await post({ ...MARK, method: "escort", pickedUpByName: "השכן" });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ needsAdult: true });
    // Nothing written: the refusal has to be before the upsert, not after it.
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a youth counselor a one-off change, even with a listed name", async () => {
    const res = await post({
      ...MARK,
      method: "escort",
      pickedUpByName: "רותי כהן",
      note: "היום סבתא",
    });
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a youth counselor sending a child home alone against the instruction", async () => {
    const res = await post({ ...MARK, method: "alone" });
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("lets a youth counselor release a child whose instruction is 'alone'", async () => {
    fixture.defaultDismissal = "alone";
    const res = await post({ ...MARK, method: "alone" });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("lets an adult counselor record the same exception", async () => {
    role = "staff";
    const res = await post({
      ...MARK,
      method: "escort",
      pickedUpByName: "השכן",
      note: "היום השכן",
    });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("does not leave a stale collector on a child who walked home alone", async () => {
    role = "staff";
    await post({ ...MARK, method: "alone", pickedUpByName: "רותי כהן" });
    const args = upsert.mock.calls[0][0] as {
      create: { pickedUpByName: string | null };
    };
    expect(args.create.pickedUpByName).toBeNull();
  });
});

describe("POST /api/dismissals — scoping", () => {
  // The id of a day says nothing about whether the child is on that event, or
  // whether the event still exists. Both come back the same way.
  it("refuses a child who is not on the event", async () => {
    fixture.day = null;
    role = "staff";
    const res = await post({ ...MARK, method: "escort", pickedUpByName: "רותי כהן" });
    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown method rather than storing it", async () => {
    role = "staff";
    const res = await post({ ...MARK, method: "taxi" });
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/dismissals — undoing a record", () => {
  const url =
    "http://localhost/api/dismissals?eventDayId=d1&participantId=p1";

  it("is closed to a youth counselor", async () => {
    const res = await DELETE(new Request(url, { method: "DELETE" }));
    expect(res.status).toBe(403);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("is open to an adult, and scopes to a live event", async () => {
    role = "staff";
    const res = await DELETE(new Request(url, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        participantId: "p1",
        eventDayId: "d1",
        eventDay: { event: { deletedAt: null } },
      },
    });
  });
});
