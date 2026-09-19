// The role vocabulary and what each role may do, kept free of auth/db imports
// so it can be validated (and unit-tested) without pulling NextAuth and Prisma
// into the module graph.

export const ROLES = ["admin", "staff", "youth"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "מנהל/ת",
  staff: "מדריך/ה בוגר/ת",
  youth: "מדריך/ת נוער",
};

export const ROLE_HINT: Record<Role, string> = {
  admin: "הכול, כולל מחיקות, שחזור ושינוי תפקידים",
  staff: "הכול חוץ ממחיקות ושינוי תפקידים",
  youth: "סימון נוכחות, צפייה ברשימה וברשימת הלוז. בלי פרטי קשר ובלי עריכת הרשימה",
};

// ── Capabilities ────────────────────────────────────────────────────────────
//
// Why a table and not `if (role === "admin")` scattered across routes: there
// are 20-odd routes and three roles now. The last time a rule had to hold
// across every route and was left to each one to remember, eleven of them
// forgot it at once (see src/lib/event-scope.ts). One table, one guard, and a
// test that walks every route is the shape that survives a third role.
//
// The list is what a role MAY do. Anything not listed is refused, so a route
// added next month is closed to youth until someone decides otherwise — the
// safe direction has to be the one you get by forgetting.

export const CAPABILITIES = [
  // Attendance — the daily job, and what a youth counselor is there to do.
  "attendance:mark",

  // The roster of children.
  "roster:view", // names and grade
  "roster:contacts", // parents' phone numbers — deliberately narrower
  "roster:edit", // add a child, rename, edit grade/contacts, import
  "roster:delete", // soft delete, restore, merge

  // Events and their days.
  "event:view",
  "event:edit", // create an event, change its range/schedule, manage its children
  "event:delete",

  // The day's schedule (לוז).
  "schedule:view",
  "schedule:edit",

  // Groups.
  "group:view",
  "group:edit",

  // Staff roster and hours (item 4 stage B, item 6).
  "shift:view:own",
  "shift:view:all",
  "shift:assign",

  // User administration.
  "users:manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ADMIN: Capability[] = [...CAPABILITIES];

const STAFF: Capability[] = [
  "attendance:mark",
  "roster:view",
  "roster:contacts",
  "roster:edit",
  "event:view",
  "event:edit",
  "schedule:view",
  "schedule:edit",
  "group:view",
  "group:edit",
  "shift:view:own",
  "shift:view:all",
  "shift:assign",
];

// A youth counselor is typically 15. They run one activity, not the session.
//
// What they get: marking attendance, seeing who is on the list, and reading the
// day's schedule and their own hours.
//
// What they deliberately do not get:
//   roster:contacts — a 15-year-old does not need every parent's phone number
//                     on their personal phone. The adult on duty has them.
//   roster:edit / roster:delete / event:edit — they mark the list, they do not
//                     shape it. Adding a child to an event is shaping it.
//   schedule:edit   — NOT because they should not plan. They should: planning
//                     the activity they are assigned to is the job. But the
//                     plan has to be approved by an adult, and there is nowhere
//                     to record "awaiting approval" yet (ActivitySlot has no
//                     status field, and prisma/ is held elsewhere). Letting
//                     them write straight into the live schedule would be the
//                     opposite of the rule, so until the approval loop exists
//                     this stays read-only. It is a temporary floor, not the
//                     intended ceiling.
const YOUTH: Capability[] = [
  "attendance:mark",
  "roster:view",
  "event:view",
  "schedule:view",
  "group:view",
  "shift:view:own",
];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: ADMIN,
  staff: STAFF,
  youth: YOUTH,
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

// An unknown role string (a value written directly to the database, a role
// removed in a later version) is treated as the least privileged thing there
// is: nothing. Falling back to "staff" would turn a typo into access.
export function capabilitiesOf(role: unknown): readonly Capability[] {
  return isRole(role) ? ROLE_CAPABILITIES[role] : [];
}
