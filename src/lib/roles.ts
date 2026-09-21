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
  youth:
    "סימון נוכחות, צפייה ברשימה, ותכנון פעילות ללוז שבוגר/ת מאשר/ת. בלי פרטי קשר ובלי עריכת הרשימה",
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

  // The day's schedule (לוז) and the approval loop around it.
  //
  // Three capabilities, not one, because planning and signing off are two
  // different acts here: a youth counselor plans the activity they run, and an
  // adult is accountable for what the day actually does. `schedule:propose`
  // writes a slot as "pending"; `schedule:edit` writes one straight into the
  // live day (its approval is implied by the act); `schedule:approve` is what
  // turns somebody else's proposal into part of the day.
  "schedule:view",
  "schedule:propose",
  "schedule:edit",
  "schedule:approve",

  // Going home. Three capabilities, not one, because the interesting line is
  // inside the act itself: recording that a child left with the person on
  // their list is the routine end of the day, while deciding WHO is on that
  // list, or departing from it, is not.
  "dismissal:view", // the end-of-day screen: who is waiting, who has gone
  "dismissal:mark", // record a dismissal that matches the standing list
  "dismissal:authorize", // edit the pickup list, and record anything off it

  // Groups. Delete is separate from edit on purpose: a group is no longer only
  // a reusable label, it is what a past session's split refers to, so removing
  // one hides part of the record. That puts it with deleting a child or an
  // event, not with renaming.
  "group:view",
  "group:edit",
  "group:delete",

  // Staff roster and hours (item 4 stage B, item 6).
  "shift:view:own",
  "shift:view:all",
  "shift:assign",

  // Handing a family their personal link (item 5), and turning one off.
  //
  // Its own capability rather than part of roster:edit, because of what a link
  // is: a URL that lets whoever holds it write to one child's record with no
  // sign-in at all. Issuing one is closer to handing out a key than to editing
  // a name, so it sits with contacts and above the day-to-day.
  "parent:link",

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
  "schedule:propose",
  "schedule:edit",
  "schedule:approve",
  "dismissal:view",
  "dismissal:mark",
  "dismissal:authorize",
  "group:view",
  "group:edit",
  "shift:view:own",
  "shift:view:all",
  "shift:assign",
  "parent:link",
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
//   schedule:edit   — NOT because they should not plan. They should, and now
//                     they can: `schedule:propose` writes their plan into the
//                     day as "pending" and an adult signs it off. What stays
//                     out of reach is writing straight into the live schedule,
//                     and approving anything — including their own proposal.
//   schedule:approve — approving your own plan is the loop with nothing in it.
//   parent:link     — a parent link is an unauthenticated write into a child's
//                     record. Minting one, or turning one off, is an adult's
//                     call; a youth counselor asks for it rather than issues it.
const YOUTH: Capability[] = [
  "attendance:mark",
  "roster:view",
  "event:view",
  "schedule:view",
  // Planning the activity they run, as a proposal an adult approves. The
  // temporary read-only floor stage A left behind — there was nowhere to hold
  // "waiting" then — is lifted now that ActivitySlot.status exists.
  "schedule:propose",
  // Signing children out is the same daily job as signing them in, and it is
  // the youth counselor who is standing at the gate when a parent arrives.
  // What they do not get is dismissal:authorize — deciding who may collect a
  // child, or waving through someone who is not on that list.
  "dismissal:view",
  "dismissal:mark",
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
