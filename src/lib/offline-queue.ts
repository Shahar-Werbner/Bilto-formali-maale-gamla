// Attendance is marked in the field, on a phone, where reception is poor. The
// old behaviour was optimistic-then-rollback: a failed request quietly undid
// the tap and showed an error, so the work was simply lost.
//
// This queue holds a mark until the server confirms it. It survives a reload
// (localStorage) and drains when the connection returns.

import type { Status } from "@/lib/attendance";

export type PendingMark = {
  eventDayId: string;
  participantId: string;
  status: Status;
  /** Distinguishes two marks for the same child; see `flush`. */
  queuedAt: number;
};

// Thrown by `send` when the server rejected the mark for a reason retrying
// cannot fix (the child is no longer on the event, the day was deleted).
// Retrying those forever would block every later mark behind them.
export class PermanentSendError extends Error {}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const QUEUE_KEY = "attendance-queue-v1";

function keyOf(mark: Pick<PendingMark, "eventDayId" | "participantId">): string {
  return `${mark.eventDayId}:${mark.participantId}`;
}

function isMark(value: unknown): value is PendingMark {
  const m = value as PendingMark;
  return (
    !!m &&
    typeof m.eventDayId === "string" &&
    typeof m.participantId === "string" &&
    typeof m.status === "string" &&
    typeof m.queuedAt === "number"
  );
}

export function createQueue(opts: {
  storage: StorageLike;
  /** Resolves when the server has stored the mark. */
  send: (mark: PendingMark) => Promise<void>;
  /** Called whenever the pending list changes, for the UI. */
  onChange?: (pending: PendingMark[]) => void;
  /** Called when a mark is dropped because the server refused it outright. */
  onDropped?: (mark: PendingMark, error: Error) => void;
  now?: () => number;
}) {
  const { storage, send, onChange, onDropped } = opts;
  const now = opts.now ?? (() => Date.now());
  let flushing = false;

  function hydrate(): PendingMark[] {
    // Storage throws in private mode and can hold anything after a version
    // change — a corrupt queue must not take the whole screen down.
    try {
      const raw = storage.getItem(QUEUE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isMark) : [];
    } catch {
      return [];
    }
  }

  // Memory is the source of truth; storage is how the queue survives a reload.
  // If storage is blocked (private browsing, blocked site data) the marks still
  // send for as long as the tab is open — losing them there would be exactly
  // the failure this queue exists to prevent.
  let memory: PendingMark[] = hydrate();

  function read(): PendingMark[] {
    return memory;
  }

  function write(marks: PendingMark[]): void {
    memory = marks;
    try {
      if (marks.length === 0) storage.removeItem(QUEUE_KEY);
      else storage.setItem(QUEUE_KEY, JSON.stringify(marks));
    } catch {
      // Not durable across a reload, but still correct for this session.
    }
    onChange?.(marks);
  }

  return {
    pending: read,

    /**
     * Queues a mark. Only the latest status per child-and-day matters, so a
     * repeated mark replaces the earlier one instead of stacking behind it.
     */
    enqueue(mark: Omit<PendingMark, "queuedAt">): PendingMark {
      const entry: PendingMark = { ...mark, queuedAt: now() };
      const rest = read().filter((m) => keyOf(m) !== keyOf(entry));
      write([...rest, entry]);
      return entry;
    },

    /**
     * Sends what is queued, oldest first, and stops at the first failure that
     * looks like a network problem — the rest would fail the same way.
     * Returns the number of marks confirmed by the server.
     */
    async flush(): Promise<number> {
      if (flushing) return 0; // a second caller would double-send
      flushing = true;
      let sent = 0;
      try {
        // Re-read between sends: the user keeps tapping while this runs.
        for (let queue = read(); queue.length > 0; queue = read()) {
          const mark = queue[0];
          try {
            await send(mark);
          } catch (err) {
            if (err instanceof PermanentSendError) {
              write(read().filter((m) => m.queuedAt !== mark.queuedAt));
              onDropped?.(mark, err);
              continue;
            }
            break; // offline or server trouble — keep everything, try later
          }
          sent++;
          // Remove by queuedAt, not by key: if the child was re-marked while
          // this request was in flight, that newer mark must survive.
          write(read().filter((m) => m.queuedAt !== mark.queuedAt));
        }
      } finally {
        flushing = false;
      }
      return sent;
    },

    clear(): void {
      write([]);
    },
  };
}

export type AttendanceQueue = ReturnType<typeof createQueue>;
