import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGISTRATION_WRITE_LIMIT, generateRegistrationToken } from "../registration";

// The registration endpoint is an unauthenticated write about minors, so the
// refusals are checked at the route, where they live: a junk token, a closed
// form and a throttled caller must be turned away before anything is written
// — and a junk token before anything is even read.

const TOKEN = generateRegistrationToken();

let formRow: Record<string, unknown> | null;
const findUnique = vi.fn(async () => formRow);
const transaction = vi.fn(async () => []);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    registrationForm: { findUnique: () => findUnique() },
    $transaction: () => transaction(),
  },
}));

const { POST } = await import("@/app/api/registration/[token]/route");

function post(token: string, body: unknown = { children: [] }, ip = "1.1.1.1") {
  return POST(
    new Request(`http://x/api/registration/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
    { params: { token } },
  );
}

const day = (id: string, date: string) => ({
  id,
  date: new Date(`${date}T00:00:00Z`),
  startTime: "16:00",
  endTime: "19:00",
  equipment: [],
});

function form(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    intro: null,
    price: null,
    capacity: null,
    autoApprove: true,
    openedAt: new Date("2020-01-01T00:00:00Z"),
    closesAt: null,
    closedAt: null,
    equipment: [],
    equipmentUpdatedAt: null,
    event: { id: "e1", name: "קייטנה", kind: "camp", deletedAt: null, days: [day("d1", "2099-01-01")] },
    ...over,
  };
}

beforeEach(() => {
  REGISTRATION_WRITE_LIMIT.reset();
  findUnique.mockClear();
  transaction.mockClear();
  formRow = form();
});

describe("POST /api/registration/<token>", () => {
  it("refuses a malformed token without touching the database", async () => {
    const res = await post("not-a-token");
    expect(res.status).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("answers an unknown token and a deleted event the same way", async () => {
    formRow = null;
    expect((await post(TOKEN)).status).toBe(404);
    formRow = form({ event: { ...form().event, deletedAt: new Date() } });
    expect((await post(TOKEN)).status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses once the deadline has passed, and writes nothing", async () => {
    formRow = form({ closesAt: new Date("2020-06-01T00:00:00Z") });
    const res = await post(TOKEN);
    expect(res.status).toBe(410);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses a form closed by hand, and one never sent", async () => {
    formRow = form({ closedAt: new Date() });
    expect((await post(TOKEN)).status).toBe(410);
    formRow = form({ openedAt: null });
    expect((await post(TOKEN)).status).toBe(410);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses an invalid body before writing", async () => {
    const res = await post(TOKEN, { children: [{ participantId: "x" }] });
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("throttles a caller, before any query", async () => {
    for (let i = 0; i < 10; i++) await post("junk", undefined, "9.9.9.9");
    findUnique.mockClear();
    const res = await post(TOKEN, undefined, "9.9.9.9");
    expect(res.status).toBe(429);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
