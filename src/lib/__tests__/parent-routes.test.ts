import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, capabilitiesOf, type Capability, type Role } from "../roles";
import {
  PARENT_READ_LIMIT,
  PARENT_WRITE_LIMIT,
  generateParentToken,
} from "../parents";

// The parents' endpoint is **the only unauthenticated write into a child's
// record in this system**, so it gets the same route-level treatment the
// dismissal routes got, and for the same reason: every rule here lives in a
// query or a guard, where neither typecheck nor a pure unit test can see it.
//
// What is being checked is the blast radius. A link must reach exactly one
// child, only while it is live, only for days that child is on — and a link
// that is none of those must not write anything at all.

const TOKEN = generateParentToken();
const OTHER_TOKEN = generateParentToken();

type LinkRow = {
  id: string;
  label: string | null;
  revokedAt: Date | null;
  participant: { id: string; name: string; grade: string | null; deletedAt: Date | null };
};

type Fixture = {
  links: Record<string, LinkRow>;
  /** Day ids this child is on, on a live event. */
  daysOnEvent: string[];
};

let fixture: Fixture;
const upsert = vi.fn();
const linkUpdate = vi.fn();

function freshFixture(): Fixture {
  return {
    links: {
      [TOKEN]: {
        id: "link-1",
        label: "אמא",
        revokedAt: null,
        participant: { id: "c1", name: "יעל", grade: "א'", deletedAt: null },
      },
    },
    daysOnEvent: ["d1"],
  };
}

const findUnique = vi.fn(async (args: { where: { token: string } }) => {
  return fixture.links[args.where.token] ?? null;
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    parentLink: {
      findUnique: (args: { where: { token: string } }) => findUnique(args),
      update: async (args: unknown) => {
        linkUpdate(args);
        return {};
      },
      findMany: async () => [],
      create: async () => ({
        id: "link-new",
        token: "t",
        label: null,
        createdAt: new Date(),
      }),
      updateMany: async () => ({ count: 1 }),
    },
    eventDay: {
      findMany: async () => [],
      findFirst: async (args: { where: { id: string } }) =>
        fixture.daysOnEvent.includes(args.where.id) ? { id: args.where.id } : null,
    },
    expectedAttendance: {
      upsert: async (args: { create: Record<string, unknown> }) => {
        upsert(args);
        return { coming: args.create.coming, note: args.create.note };
      },
    },
    participant: { findFirst: async () => ({ id: "c1" }) },
  },
}));

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

const parent = await import("@/app/api/parent/[token]/route");
const links = await import("@/app/api/parent-links/route");

function get(token: string) {
  return parent.GET(new Request(`http://localhost/api/parent/${token}`), {
    params: { token },
  });
}

function post(token: string, body: Record<string, unknown>) {
  return parent.POST(
    new Request(`http://localhost/api/parent/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { token } },
  );
}

beforeEach(() => {
  fixture = freshFixture();
  upsert.mockClear();
  linkUpdate.mockClear();
  findUnique.mockClear();
  role = "staff";
  // The limiters are module-level singletons, as they are in production. Each
  // test starts with its allowance back.
  PARENT_READ_LIMIT.reset();
  PARENT_WRITE_LIMIT.reset();
});

describe("GET /api/parent/<token>", () => {
  it("shows the child the link belongs to", async () => {
    const res = await get(TOKEN);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.child).toEqual({ id: "c1", name: "יעל", grade: "א'" });
    expect(data.label).toBe("אמא");
  });

  it("records that somebody opened it", async () => {
    // "Never answered" and "never received the link" are different problems
    // with different fixes, and this timestamp is what tells them apart.
    await get(TOKEN);
    expect(linkUpdate).toHaveBeenCalled();
  });

  it("refuses an unknown token", async () => {
    const res = await get(OTHER_TOKEN);
    expect(res.status).toBe(404);
  });

  it("never queries the database for a token that is not even the right shape", async () => {
    // The endpoint is open. The cheapest refusal is the one that costs no
    // query, and a token going near a query is also how one ends up somewhere
    // it should not.
    for (const junk of ["abc", "../../etc/passwd", "%00", "x".repeat(400)]) {
      const res = await get(junk);
      expect(res.status).toBe(404);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("tells a revoked link apart from an unknown one", async () => {
    // Deliberate: the family already holds this token, so confirming it used
    // to work leaks nothing, and "ask the staff for a new link" is something
    // they can act on where a bare 404 is not.
    fixture.links[TOKEN].revokedAt = new Date();
    const res = await get(TOKEN);
    expect(res.status).toBe(410);
    expect((await res.json()).revoked).toBe(true);
  });

  it("treats a link to a deleted child as unknown, not as revoked", async () => {
    // Invariant 1 has no exception for the one screen a parent sees, and the
    // link was never turned off — so there is nothing to tell them about.
    fixture.links[TOKEN].participant.deletedAt = new Date();
    const res = await get(TOKEN);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/parent/<token>", () => {
  it("records what the parent said", async () => {
    const res = await post(TOKEN, {
      eventDayId: "d1",
      coming: false,
      note: "היום סבתא אוספת",
    });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eventDayId: "d1",
          participantId: "c1",
          coming: false,
          note: "היום סבתא אוספת",
        }),
      }),
    );
  });

  it("refuses a day the child is not on", async () => {
    // The day id arrives in a request body from an open endpoint. Holding one
    // family's link must not be a way to write a row against another session.
    const res = await post(TOKEN, { eventDayId: "d-other", coming: true });
    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses to write anything with a revoked link", async () => {
    fixture.links[TOKEN].revokedAt = new Date();
    const res = await post(TOKEN, { eventDayId: "d1", coming: true });
    expect(res.status).toBe(410);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses to write anything with an unknown link", async () => {
    const res = await post(OTHER_TOKEN, { eventDayId: "d1", coming: true });
    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses an answer that does not say yes or no", async () => {
    const res = await post(TOKEN, { eventDayId: "d1", note: "אולי" });
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses a missing day id", async () => {
    const res = await post(TOKEN, { coming: true });
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("cannot be used to write for a different child", async () => {
    // There is no participantId in the contract, and adding one to the body
    // must not start being honoured.
    await post(TOKEN, { eventDayId: "d1", coming: true, participantId: "c2" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ participantId: "c1" }),
      }),
    );
  });

  it("throttles a caller hammering the endpoint", async () => {
    let last = await post(TOKEN, { eventDayId: "d1", coming: true });
    for (let i = 0; i < 40 && last.status !== 429; i++) {
      last = await post(TOKEN, { eventDayId: "d1", coming: true });
    }
    expect(last.status).toBe(429);
  });
});

describe("/api/parent-links", () => {
  function linksGet(query: string) {
    return links.GET(new Request(`http://localhost/api/parent-links?${query}`));
  }

  it("lets an adult counselor issue a link", async () => {
    role = "staff";
    const res = await links.POST(
      new Request("http://localhost/api/parent-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: "c1", label: "אמא" }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("refuses a youth counselor — minting one is an adult's call", async () => {
    role = "youth";
    for (const res of [
      await linksGet("participantId=c1"),
      await links.POST(
        new Request("http://localhost/api/parent-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: "c1" }),
        }),
      ),
      await links.DELETE(
        new Request("http://localhost/api/parent-links?id=link-1", {
          method: "DELETE",
        }),
      ),
    ]) {
      expect(res.status).toBe(403);
    }
  });

  it("revokes rather than deletes, so the token cannot come back", async () => {
    role = "admin";
    const res = await links.DELETE(
      new Request("http://localhost/api/parent-links?id=link-1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
  });
});
