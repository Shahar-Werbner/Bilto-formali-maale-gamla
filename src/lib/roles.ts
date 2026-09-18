// The role vocabulary, kept free of auth/db imports so it can be validated
// (and unit-tested) without pulling NextAuth and Prisma into the module graph.

export const ROLES = ["admin", "staff"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "מנהל/ת",
  staff: "צוות",
};
