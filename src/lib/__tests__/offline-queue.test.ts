import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQueue,
  PermanentSendError,
  QUEUE_KEY,
  type PendingMark,
  type StorageLike,
} from "../offline-queue";

function memoryStorage(): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (k) => raw.get(k) ?? null,
    setItem: (k, v) => void raw.set(k, v),
    removeItem: (k) => void raw.delete(k),
  };
}

const mark = (participantId: string, status: "present" | "absent" = "present") => ({
  eventDayId: "day-1",
  participantId,
  status,
});

describe("offline queue", () => {
  let storage: ReturnType<typeof memoryStorage>;
  let clock: number;

  beforeEach(() => {
    storage = memoryStorage();
    clock = 1000;
  });

  const build = (send: (m: PendingMark) => Promise<void>, extra = {}) =>
    createQueue({ storage, send, now: () => clock++, ...extra });

  it("holds a mark until the server confirms it", async () => {
    const sent: PendingMark[] = [];
    const q = build(async (m) => void sent.push(m));

    q.enqueue(mark("kid-1"));
    expect(q.pending()).toHaveLength(1);

    expect(await q.flush()).toBe(1);
    expect(sent.map((m) => m.participantId)).toEqual(["kid-1"]);
    expect(q.pending()).toHaveLength(0);
  });

  it("keeps the mark when the network is down, and sends it later", async () => {
    let online = false;
    const sent: string[] = [];
    const q = build(async (m) => {
      if (!online) throw new Error("offline");
      sent.push(m.participantId);
    });

    q.enqueue(mark("kid-1"));
    expect(await q.flush()).toBe(0);
    expect(q.pending()).toHaveLength(1); // nothing lost

    online = true;
    expect(await q.flush()).toBe(1);
    expect(sent).toEqual(["kid-1"]);
    expect(q.pending()).toHaveLength(0);
  });

  it("survives a reload: the queue is read back from storage", async () => {
    const first = build(async () => {
      throw new Error("offline");
    });
    first.enqueue(mark("kid-1"));
    await first.flush();

    // A fresh queue over the same storage, as after a page reload.
    const sent: string[] = [];
    const second = build(async (m) => void sent.push(m.participantId));
    expect(second.pending()).toHaveLength(1);
    await second.flush();
    expect(sent).toEqual(["kid-1"]);
  });

  it("keeps only the latest status per child, in tap order", async () => {
    const sent: PendingMark[] = [];
    const q = build(async (m) => void sent.push(m));

    q.enqueue(mark("kid-1", "present"));
    q.enqueue(mark("kid-2", "present"));
    q.enqueue(mark("kid-1", "absent")); // corrected

    expect(q.pending()).toHaveLength(2);
    await q.flush();
    expect(sent.map((m) => [m.participantId, m.status])).toEqual([
      ["kid-2", "present"],
      ["kid-1", "absent"],
    ]);
  });

  it("does not lose a mark made while an earlier one is in flight", async () => {
    // The race that silently drops work: kid-1 is being sent when the user
    // corrects kid-1. Removing by child would delete the correction too.
    const sent: PendingMark[] = [];
    let q: ReturnType<typeof build>;
    q = build(async (m) => {
      sent.push(m);
      if (m.status === "present") q.enqueue(mark("kid-1", "absent"));
    });

    q.enqueue(mark("kid-1", "present"));
    await q.flush();

    expect(sent.map((m) => m.status)).toEqual(["present", "absent"]);
    expect(q.pending()).toHaveLength(0);
  });

  it("stops at the first network failure instead of hammering the rest", async () => {
    const tried: string[] = [];
    const q = build(async (m) => {
      tried.push(m.participantId);
      throw new Error("offline");
    });

    q.enqueue(mark("kid-1"));
    q.enqueue(mark("kid-2"));
    q.enqueue(mark("kid-3"));

    expect(await q.flush()).toBe(0);
    expect(tried).toEqual(["kid-1"]);
    expect(q.pending()).toHaveLength(3);
  });

  it("drops a mark the server refuses outright, and keeps going", async () => {
    const dropped: PendingMark[] = [];
    const sent: string[] = [];
    const q = build(
      async (m) => {
        if (m.participantId === "gone") {
          throw new PermanentSendError("not on this event");
        }
        sent.push(m.participantId);
      },
      { onDropped: (m: PendingMark) => void dropped.push(m) },
    );

    q.enqueue(mark("gone"));
    q.enqueue(mark("kid-2"));

    expect(await q.flush()).toBe(1);
    expect(sent).toEqual(["kid-2"]);
    expect(dropped.map((m) => m.participantId)).toEqual(["gone"]);
    expect(q.pending()).toHaveLength(0);
  });

  it("will not double-send when flush is called twice at once", async () => {
    const sent: string[] = [];
    const q = build(async (m) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(m.participantId);
    });

    q.enqueue(mark("kid-1"));
    const [a, b] = await Promise.all([q.flush(), q.flush()]);

    expect(sent).toEqual(["kid-1"]);
    expect(a + b).toBe(1);
  });

  it("reports the pending list to the UI on every change", () => {
    const seen: number[] = [];
    const q = createQueue({
      storage,
      send: async () => {},
      onChange: (p) => seen.push(p.length),
      now: () => clock++,
    });

    q.enqueue(mark("kid-1"));
    q.enqueue(mark("kid-2"));
    q.clear();
    expect(seen).toEqual([1, 2, 0]);
  });

  it("ignores a corrupt or foreign value in storage", async () => {
    storage.raw.set(QUEUE_KEY, "not json at all");
    expect(build(async () => {}).pending()).toEqual([]);

    storage.raw.set(QUEUE_KEY, JSON.stringify([{ nonsense: true }, null]));
    expect(build(async () => {}).pending()).toEqual([]);
  });

  it("still sends when storage refuses to write", async () => {
    // Private browsing: setItem throws. The mark is not durable across a
    // reload, but losing it outright is the failure this queue exists to
    // prevent — it must still reach the server while the tab is open.
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const sent: string[] = [];
    const q = createQueue({
      storage: throwing,
      send: async (m) => void sent.push(m.participantId),
      now: () => clock++,
    });

    expect(() => q.enqueue(mark("kid-1"))).not.toThrow();
    expect(q.pending()).toHaveLength(1);
    await q.flush();
    expect(sent).toEqual(["kid-1"]);
    expect(q.pending()).toHaveLength(0);
  });
});
