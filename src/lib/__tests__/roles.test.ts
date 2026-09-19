import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  ROLES,
  ROLE_CAPABILITIES,
  ROLE_LABEL,
  can,
  capabilitiesOf,
  isRole,
  type Capability,
} from "../roles";

describe("isRole", () => {
  it("accepts the roles the system defines", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
  });

  it("rejects anything else", () => {
    // The role arrives from a request body, so "superadmin" or a stray object
    // must not reach prisma.user.update.
    for (const bad of ["superadmin", "Admin", "", null, undefined, {}, 1]) {
      expect(isRole(bad)).toBe(false);
    }
  });
});

describe("capabilities", () => {
  it("gives admin everything", () => {
    for (const c of CAPABILITIES) expect(can("admin", c)).toBe(true);
  });

  // The owner's decision, 19.09: an adult counselor may rename a group but not
  // delete one. Deleting hides a name that past sessions still point at, so it
  // belongs with deleting a child or an event, not with editing.
  it("lets an adult counselor rename a group but not delete one", () => {
    expect(can("staff", "group:edit")).toBe(true);
    expect(can("staff", "group:delete")).toBe(false);
    expect(can("admin", "group:delete")).toBe(true);
  });

  it("withholds only deletion and user management from an adult counselor", () => {
    const missing = CAPABILITIES.filter((c) => !can("staff", c));
    expect([...missing].sort()).toEqual(
      // group:delete sits with the other deletions rather than with group:edit:
      // hiding a group hides what past sessions refer to, so it is the same
      // class of act as deleting a child or an event. Renaming a group is not.
      ["event:delete", "group:delete", "roster:delete", "users:manage"].sort(),
    );
  });

  // The whole point of the role. Each of these is a specific thing a 15-year-old
  // on their own phone should not be able to do.
  it.each([
    ["roster:contacts", "every parent's phone number"],
    ["roster:edit", "renaming or adding a child"],
    ["roster:delete", "deleting a child"],
    ["event:edit", "reshaping an event, including who is on it"],
    ["event:delete", "deleting an event"],
    ["group:edit", "changing the groups"],
    ["group:delete", "deleting a group, and with it what past sessions refer to"],
    ["users:manage", "handing out roles"],
    ["shift:assign", "rostering staff"],
    ["shift:view:all", "other people's hours"],
  ] as const)("denies youth %s — %s", (capability, _why) => {
    expect(can("youth", capability)).toBe(false);
  });

  // ...and the things the role exists to allow.
  it.each([
    ["attendance:mark", "marking who turned up — the daily job"],
    ["roster:view", "seeing the list they are marking"],
    ["event:view", "seeing the sessions"],
    ["schedule:view", "reading the day's plan they work from"],
    ["shift:view:own", "their own hours"],
  ] as const)("allows youth %s — %s", (capability, _why) => {
    expect(can("youth", capability)).toBe(true);
  });

  it("gives youth strictly less than an adult counselor", () => {
    for (const c of ROLE_CAPABILITIES.youth) expect(can("staff", c)).toBe(true);
    expect(ROLE_CAPABILITIES.youth.length).toBeLessThan(
      ROLE_CAPABILITIES.staff.length,
    );
  });

  it("treats an unknown role as having nothing, not as staff", () => {
    // A role string written straight into the database, or one removed in a
    // later version. Falling back to a real role would turn a typo into access.
    for (const bad of ["superadmin", "", null, undefined, "STAFF"]) {
      expect(capabilitiesOf(bad)).toEqual([]);
    }
    expect(capabilitiesOf("youth")).toEqual(ROLE_CAPABILITIES.youth);
  });

  it("names and describes every role for the admin screen", () => {
    for (const role of ROLES) expect(ROLE_LABEL[role]?.length).toBeGreaterThan(1);
  });

  it("lists no capability twice and none that is not declared", () => {
    for (const role of ROLES) {
      const caps = ROLE_CAPABILITIES[role];
      expect(new Set(caps).size).toBe(caps.length);
      for (const c of caps) expect(CAPABILITIES).toContain(c as Capability);
    }
  });
});

// ── Every route has to declare what it needs ────────────────────────────────
//
// `requireSession()` means "anyone signed in". While there were two roles that
// was almost the same as "any staff member"; with youth it is not, and a route
// left on it hands a 15-year-old whatever it does. This sweep is what stops the
// next route from being added that way.

const API_DIR = join(process.cwd(), "src/app/api");

// Routes that are open on purpose, each with the reason.
const UNGUARDED: Record<string, string> = {
  "auth/[...nextauth]/route.ts": "the sign-in endpoint itself — it cannot require a session",
  "register/route.ts":
    "self-registration, guarded by the signup code, rate limiting and a timing-safe comparison instead",
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

describe("every API route declares its permission", () => {
  const files = routeFiles(API_DIR);

  it("finds the routes at all", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s", (rel) => {
    const src = readFileSync(join(API_DIR, rel), "utf8");
    if (UNGUARDED[rel]) {
      expect(UNGUARDED[rel].length).toBeGreaterThan(20);
      return;
    }

    expect(
      /requireCapability\(/.test(src) || /requireAdmin\(/.test(src),
      `${rel} does not call requireCapability() or requireAdmin().\n` +
        `A bare requireSession() means "anyone signed in", which now includes ` +
        `youth counselors. Declare what the route needs, or add it to UNGUARDED ` +
        `in this file with the reason it is open.`,
    ).toBe(true);

    expect(
      /requireSession\(/.test(src),
      `${rel} still calls requireSession(). Use requireCapability("…") so the ` +
        `route says what it needs and roles.ts stays the single place that decides.`,
    ).toBe(false);
  });

  it("every exemption names a route that still exists", () => {
    for (const rel of Object.keys(UNGUARDED)) expect(files).toContain(rel);
  });
});
