import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  liveActivitySlot,
  liveDayRow,
  liveEvent,
  liveEventDay,
  liveGroup,
} from "../event-scope";

// Invariant 1 (CLAUDE.md): a soft-deleted Event has to be gone from every
// screen, export and report.
//
// Eleven write paths once violated it at the same time, and every one of them
// was a *query*, not a calculation — so neither the unit tests nor `typecheck`
// could see them. This file is the guard that can: it reads the route sources
// and refuses a route that reaches an event, a child, or anything hanging off
// an EventDay without scoping the query.
//
// It is deliberately crude. It cannot prove a filter is correct, only that one
// is present — but "present" is exactly what was missing all eleven times, and
// a new route now has to either use the helper or come here and say why not.

const API_DIR = join(process.cwd(), "src/app/api");

// Models whose rows are reachable by an id that says nothing about the event
// above them. Reaching one of these means the query has to be scoped.
const SCOPED_MODELS = [
  "event",
  "eventDay",
  "eventAttendance",
  "activitySlot",
  "participant",
  "dismissal",
  "dayGroupAssignment",
  "pickupAuthorization",
  "shift",
  // Group is soft-deleted for a different reason than the rest — it is part of
  // the record of a past session — but it scopes exactly the same way.
  "group",
];

// Routes that legitimately need no scoping. Each one states why, because an
// entry added without a reason is how this guard would quietly stop working.
const EXEMPT: Record<string, string> = {
  "admin/restore/route.ts":
    "its whole job is to act on soft-deleted rows — scoping them out would break restore",
  "participants/import/route.ts":
    "compares against every name, deleted included, so a re-import surfaces as a skip rather than silently creating a second copy (see the comment there)",
  "admin/users/[id]/route.ts": "acts on User, which has no soft delete",
  "register/route.ts": "creates a User; no event or child is resolved",
};

function routeFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...routeFiles(full, rel));
    else if (entry === "route.ts") out.push(rel);
  }
  return out;
}

describe("soft-delete scoping across API routes", () => {
  const files = routeFiles(API_DIR);

  it("finds the API routes at all (so an empty sweep cannot pass silently)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s scopes its queries to live rows", (rel) => {
    const src = readFileSync(join(API_DIR, rel), "utf8");

    const touches = SCOPED_MODELS.some((m) =>
      new RegExp(`prisma\\.${m}\\b`).test(src),
    );
    if (!touches) return;

    if (EXEMPT[rel]) {
      // Keep the exemption honest: it has to carry a reason.
      expect(EXEMPT[rel].length).toBeGreaterThan(20);
      return;
    }

    const scoped =
      /@\/lib\/event-scope/.test(src) || /deletedAt/.test(src);

    expect(
      scoped,
      `${rel} queries ${SCOPED_MODELS.filter((m) => new RegExp(`prisma\\.${m}\\b`).test(src)).join(", ")} ` +
        `without filtering deletedAt or importing from @/lib/event-scope.\n` +
        `Either scope the query (see src/lib/event-scope.ts) or add ${rel} to EXEMPT ` +
        `in this file with the reason it needs no scoping.`,
    ).toBe(true);
  });

  it("every exemption names a route that still exists", () => {
    for (const rel of Object.keys(EXEMPT)) expect(files).toContain(rel);
  });
});

describe("the scope filters themselves", () => {
  it("scopes an event by its own deletedAt", () => {
    expect(liveEvent("e1")).toEqual({ id: "e1", deletedAt: null });
  });

  it("scopes a day through its event", () => {
    expect(liveEventDay("d1")).toEqual({
      id: "d1",
      event: { deletedAt: null },
    });
  });

  it("scopes a group by its own deletedAt", () => {
    expect(liveGroup("g1")).toEqual({ id: "g1", deletedAt: null });
  });

  it("scopes anything hanging off a day through the day's event", () => {
    const expected = { id: "x1", eventDay: { event: { deletedAt: null } } };
    expect(liveDayRow("x1")).toEqual(expected);
    // A slot, a dismissal, a group assignment and a shift all scope alike.
    expect(liveActivitySlot("x1")).toEqual(expected);
  });
});
