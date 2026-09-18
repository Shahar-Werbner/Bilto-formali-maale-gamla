import { describe, expect, it } from "vitest";
import { isRole, ROLES } from "../roles";

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
