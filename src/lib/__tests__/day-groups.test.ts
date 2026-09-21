import { describe, expect, it } from "vitest";
import {
  isPrefillSource,
  prefillAssignments,
  splitSummary,
  type PrefillChild,
} from "../day-groups";

// The three groups a session is split into, named the way the team names them.
const GROUPS = [
  { id: "g-a", name: "א׳" },
  { id: "g-b", name: "ב׳" },
  { id: "g-lions", name: "האריות" },
];

function child(over: Partial<PrefillChild> & { participantId: string }): PrefillChild {
  return { ...over };
}

describe("prefill from the standing membership", () => {
  it("places a child who belongs to exactly one group", () => {
    const { assignments, unmatched } = prefillAssignments({
      source: "standing",
      groups: GROUPS,
      children: [child({ participantId: "p1", standingGroupIds: ["g-lions"] })],
    });
    expect(assignments).toEqual([{ participantId: "p1", groupId: "g-lions" }]);
    expect(unmatched).toEqual([]);
  });

  it("leaves a child who is in two groups unassigned rather than guessing", () => {
    // The membership is many-to-many on purpose. Picking one of the two here
    // would look exactly like a decision someone made.
    const { assignments, unmatched } = prefillAssignments({
      source: "standing",
      groups: GROUPS,
      children: [
        child({ participantId: "p1", standingGroupIds: ["g-a", "g-lions"] }),
      ],
    });
    expect(assignments).toEqual([]);
    expect(unmatched).toEqual(["p1"]);
  });

  it("leaves a child who is in no group unassigned", () => {
    const { unmatched } = prefillAssignments({
      source: "standing",
      groups: GROUPS,
      children: [child({ participantId: "p1", standingGroupIds: [] })],
    });
    expect(unmatched).toEqual(["p1"]);
  });

  it("ignores a membership in a group that has since been deleted", () => {
    const { unmatched } = prefillAssignments({
      source: "standing",
      groups: GROUPS,
      children: [child({ participantId: "p1", standingGroupIds: ["g-gone"] })],
    });
    expect(unmatched).toEqual(["p1"]);
  });
});

describe("prefill by copying the previous session", () => {
  it("copies where each child was last time", () => {
    const { assignments } = prefillAssignments({
      source: "previous",
      groups: GROUPS,
      children: [
        child({ participantId: "p1", previousGroupId: "g-b" }),
        child({ participantId: "p2", previousGroupId: "g-lions" }),
      ],
    });
    expect(assignments).toEqual([
      { participantId: "p1", groupId: "g-b" },
      { participantId: "p2", groupId: "g-lions" },
    ]);
  });

  it("leaves a child who was not at the previous session unassigned", () => {
    // A child who joined this week has nothing to copy, and their standing
    // group is deliberately not used as a fallback: the button says which
    // source it is filling from.
    const { assignments, unmatched } = prefillAssignments({
      source: "previous",
      groups: GROUPS,
      children: [
        child({ participantId: "p1", previousGroupId: "g-b" }),
        child({ participantId: "p2", standingGroupIds: ["g-a"] }),
      ],
    });
    expect(assignments).toEqual([{ participantId: "p1", groupId: "g-b" }]);
    expect(unmatched).toEqual(["p2"]);
  });

  it("does not copy into a group that has since been deleted", () => {
    const { unmatched } = prefillAssignments({
      source: "previous",
      groups: GROUPS,
      children: [child({ participantId: "p1", previousGroupId: "g-gone" })],
    });
    expect(unmatched).toEqual(["p1"]);
  });
});

describe("prefill by grade", () => {
  it("matches a child's grade to the group named for it", () => {
    const { assignments } = prefillAssignments({
      source: "grade",
      groups: GROUPS,
      children: [
        child({ participantId: "p1", grade: "א'" }),
        child({ participantId: "p2", grade: "ב'" }),
      ],
    });
    expect(assignments).toEqual([
      { participantId: "p1", groupId: "g-a" },
      { participantId: "p2", groupId: "g-b" },
    ]);
  });

  it("matches a grade written with a class number to the plain grade group", () => {
    // Grades are free text: "א'1" and "א" are the same grade to everyone here.
    const { assignments } = prefillAssignments({
      source: "grade",
      groups: GROUPS,
      children: [child({ participantId: "p1", grade: "א'1" })],
    });
    expect(assignments).toEqual([{ participantId: "p1", groupId: "g-a" }]);
  });

  it("leaves a child unassigned when no group carries their grade", () => {
    const { assignments, unmatched } = prefillAssignments({
      source: "grade",
      groups: GROUPS,
      children: [
        child({ participantId: "p1", grade: "ג'" }),
        child({ participantId: "p2", grade: null }),
      ],
    });
    expect(assignments).toEqual([]);
    expect(unmatched).toEqual(["p1", "p2"]);
  });

  it("refuses to choose when two groups carry the same grade", () => {
    const { assignments, unmatched } = prefillAssignments({
      source: "grade",
      groups: [
        { id: "g-a1", name: "א׳ 1" },
        { id: "g-a2", name: "א׳ 2" },
      ],
      children: [child({ participantId: "p1", grade: "א'" })],
    });
    expect(assignments).toEqual([]);
    expect(unmatched).toEqual(["p1"]);
  });
});

describe("prefill never overwrites what the day already says", () => {
  it.each(["standing", "previous", "grade"] as const)(
    "keeps a child the day already placed — source %s",
    (source) => {
      const { assignments, kept } = prefillAssignments({
        source,
        groups: GROUPS,
        children: [
          child({
            participantId: "p1",
            currentGroupId: "g-lions",
            standingGroupIds: ["g-a"],
            previousGroupId: "g-b",
            grade: "א'",
          }),
        ],
      });
      // Pressing a prefill button after fixing a few children by hand — or
      // twice by accident — must not undo the corrections.
      expect(assignments).toEqual([]);
      expect(kept).toEqual(["p1"]);
    },
  );

  it("fills only the children who are still unassigned", () => {
    const { assignments, kept, unmatched } = prefillAssignments({
      source: "standing",
      groups: GROUPS,
      children: [
        child({ participantId: "p1", currentGroupId: "g-a", standingGroupIds: ["g-b"] }),
        child({ participantId: "p2", standingGroupIds: ["g-b"] }),
        child({ participantId: "p3", standingGroupIds: [] }),
      ],
    });
    expect(assignments).toEqual([{ participantId: "p2", groupId: "g-b" }]);
    expect(kept).toEqual(["p1"]);
    expect(unmatched).toEqual(["p3"]);
  });
});

describe("isPrefillSource", () => {
  it("accepts the three sources and nothing else", () => {
    for (const s of ["standing", "previous", "grade"]) {
      expect(isPrefillSource(s)).toBe(true);
    }
    for (const bad of ["random", "", null, undefined, {}, 1]) {
      expect(isPrefillSource(bad)).toBe(false);
    }
  });
});

describe("splitSummary", () => {
  it("reports a day nobody has been placed on as not split", () => {
    // The distinction the whole screen rests on: no assignments means the
    // split has not been done, not that everyone is in their standing group.
    const summary = splitSummary(
      [{ groupId: null }, { groupId: null }],
      GROUPS,
    );
    expect(summary).toMatchObject({ notSplit: true, assigned: 0, unassigned: 2 });
    expect(summary.perGroup).toEqual([]);
  });

  it("counts each group that holds someone, in the groups' own order", () => {
    const summary = splitSummary(
      [
        { groupId: "g-lions" },
        { groupId: "g-a" },
        { groupId: "g-lions" },
        { groupId: null },
      ],
      GROUPS,
    );
    expect(summary.notSplit).toBe(false);
    expect(summary.assigned).toBe(3);
    expect(summary.unassigned).toBe(1);
    expect(summary.perGroup).toEqual([
      { groupId: "g-a", name: "א׳", count: 1 },
      { groupId: "g-lions", name: "האריות", count: 2 },
    ]);
  });
});
