import { describe, expect, it } from "vitest";
import {
  SLOT_STATUSES,
  SLOT_STATUS_LABEL,
  canChangeSlot,
  isSlotStatus,
  pendingCount,
  slotStatusOf,
  statusAfterEdit,
  statusForNewSlot,
} from "../schedule";

describe("slot status", () => {
  it("accepts the three the system defines and nothing else", () => {
    for (const s of SLOT_STATUSES) expect(isSlotStatus(s)).toBe(true);
    for (const bad of ["Approved", "ok", "", null, undefined, 1, {}]) {
      expect(isSlotStatus(bad)).toBe(false);
    }
  });

  it("reads an unknown status as waiting, never as approved", () => {
    // A value written straight into the database, or left by a version that
    // knew a fourth status. Falling back to "approved" would take a plan
    // nobody checked for part of the day.
    for (const bad of ["ok", "", null, undefined, 7]) {
      expect(slotStatusOf(bad)).toBe("pending");
    }
    expect(slotStatusOf("approved")).toBe("approved");
  });

  it("names every status for the screen", () => {
    for (const s of SLOT_STATUSES) expect(SLOT_STATUS_LABEL[s].length).toBeGreaterThan(1);
  });
});

describe("statusForNewSlot", () => {
  it("approves what an adult writes, by the act of writing it", () => {
    // The column's default is "approved" for the same reason: asking someone
    // who may edit the schedule to then approve their own row is a loop with
    // nothing in it.
    expect(statusForNewSlot(true)).toBe("approved");
  });

  it("sends a proposal to the queue", () => {
    expect(statusForNewSlot(false)).toBe("pending");
  });
});

describe("canChangeSlot", () => {
  it("lets an adult change anything", () => {
    for (const status of SLOT_STATUSES) {
      expect(canChangeSlot({ status, canEdit: true, canPropose: false })).toBe(true);
    }
  });

  it("lets a proposer fix a plan that is not part of the day yet", () => {
    for (const status of ["pending", "draft"]) {
      expect(canChangeSlot({ status, canEdit: false, canPropose: true })).toBe(true);
    }
  });

  it("stops a proposer rewriting an approved slot", () => {
    expect(
      canChangeSlot({ status: "approved", canEdit: false, canPropose: true }),
    ).toBe(false);
  });

  it("stops someone with neither capability outright", () => {
    expect(
      canChangeSlot({ status: "pending", canEdit: false, canPropose: false }),
    ).toBe(false);
  });

  it("refuses an unknown status to a proposer only when it reads as approved", () => {
    // slotStatusOf sends anything unrecognised to "pending", so a corrupt row
    // stays editable by its proposer rather than freezing.
    expect(
      canChangeSlot({ status: "nonsense", canEdit: false, canPropose: true }),
    ).toBe(true);
  });
});

describe("statusAfterEdit", () => {
  it("leaves an approved slot approved when an adult edits it", () => {
    expect(statusAfterEdit({ status: "approved", canEdit: true })).toBe("approved");
  });

  it("does not silently re-open an adult's edit of a pending slot", () => {
    // An adult editing a pending slot has not approved it — approving is its
    // own act, with a name and a time against it.
    expect(statusAfterEdit({ status: "pending", canEdit: true })).toBe("pending");
  });

  it("puts a corrected proposal back in the queue", () => {
    // Otherwise a slot sent back for a fix would sit in "הוחזר לתיקון" after
    // being fixed, waiting for a re-submit button that does not exist.
    expect(statusAfterEdit({ status: "draft", canEdit: false })).toBe("pending");
    expect(statusAfterEdit({ status: "pending", canEdit: false })).toBe("pending");
  });
});

describe("pendingCount", () => {
  it("counts what is waiting for an adult", () => {
    expect(
      pendingCount([
        { status: "approved" },
        { status: "pending" },
        { status: "draft" },
        { status: "pending" },
      ]),
    ).toBe(2);
  });

  it("counts a row with no status at all as waiting", () => {
    // Same safe direction as slotStatusOf.
    expect(pendingCount([{}])).toBe(1);
  });
});
