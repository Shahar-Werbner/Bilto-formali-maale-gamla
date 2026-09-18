# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An attendance and day-planning system for informal education in Maale Gamla.
It is **live and used daily by the staff, from phones, in the field** — often
with poor reception. Every merge to `main` deploys to production. The records
are about children, so deleting or mixing them up has real consequences.

UI is Hebrew and RTL throughout; code and comments are English.

## Commands

```bash
npm run dev          # local dev server
npm run build        # prisma generate && prisma migrate deploy && next build
npm test             # vitest, all unit tests
npm run lint
npm run typecheck    # tsc --noEmit
npx vitest run src/lib/__tests__/events.test.ts     # a single test file
npx vitest run -t "skips Friday"                    # a single test by name
npm run prisma:migrate   # create a migration (dev)
npm run seed             # first admin user + demo data
```

CI runs lint, typecheck and test on every PR. Run all three before pushing.

## Architecture

**Attendance happens only through events.** `Event` (a camp, an activity week)
spans a date range and generates an `EventDay` per day; weekends are skipped
unless explicitly included. `EventAttendance` is one row per (day, child),
unique on that pair. There is no standalone "today" screen — a date without an
event has nowhere to record attendance.

**Two independent many-to-many links.** `Participant ↔ Group` (which groups a
child belongs to) and `Participant ↔ Event` (who is on this event) are
separate. Adding a child to a group does **not** put them on an existing event.
This surprises people; it is deliberate.

**Auth is split for the Edge runtime.** `src/auth.config.ts` is edge-safe (no
Prisma, no bcrypt) and is what `middleware.ts` imports; `src/auth.ts` adds the
Credentials provider. Anything touching the database must not leak into
`auth.config.ts`.

**Client writes to attendance go through the offline queue**
(`src/lib/offline-queue.ts`), not straight to `fetch`. A mark is held until the
server confirms it. Do not reintroduce optimistic-then-rollback here: a failed
request silently undoing a tap is exactly the bug that lost work in the field.

**Legacy, intentionally unused:** the `AttendanceRecord` model and
`Participant.sortOrder`. They hold old data and are kept out of a wish to not
delete it. Nothing reads them; do not write to them.

## Invariants

These are the things a change will break without any test failing:

1. **Filter soft deletes.** `Event` and `Participant` have `deletedAt`. Every
   query that lists or resolves them must filter `deletedAt: null` — pages,
   API routes, exports and reports alike. A missed filter resurrects a deleted
   child in one screen only.
2. **Admin-only operations use `requireAdmin()`** from `src/lib/api-auth.ts`:
   deleting an event or a child, restoring one, changing a role. It re-reads
   the role from the database on purpose — the JWT lives for days, so trusting
   it would leave a demoted admin with admin powers.
3. **One owner for `prisma/`.** Migrations run during the Vercel build, _including
   on pull-request previews_, against whatever database that environment points
   at. Two branches carrying migrations apply them to the same database with
   nothing merged. Never add a migration in parallel with another session, and
   never let one reach a PR without saying so.
4. **Dates are calendar days, not timestamps.** `@db.Date` columns, parsed to
   midnight UTC via `parseDateOnly`. "Today" comes from `todayDateOnly()`,
   which resolves in `Asia/Jerusalem` — deriving it from the server's UTC clock
   shows yesterday between midnight and 02:00 local.
5. **API routes catch their own errors** and map them through
   `handleApiError` (`src/lib/api-error.ts`), so a deleted row returns 404
   rather than a 500 with a stack trace.
6. **Sort lists with `sortByGrade`.** Grade order (א→ב→ג…) is the expected
   order everywhere; alphabetical is not.

## Verifying work

`npm run typecheck` passing means almost nothing here. Several real bugs in
this repo — a crashing export, a timezone-wrong default day, a button pushed
off a phone screen — were invisible to it.

`docs/dev-environment.md` has the tested recipe for running a local Postgres,
signing in through Auth.js with curl, driving the app in Chromium, and reading
a generated `.xlsx`. **Check behaviour against a real database, and look at the
result at 390px wide**, which is how the team actually uses this.

## Working across sessions

- `docs/ROADMAP.md` — what is planned, who owns which paths, and the rules for
  working in parallel. **Read it before starting; claim your item in it.**
- `docs/PROJECT-SUMMARY.md` — what exists today and why it was built that way.
- `docs/dev-environment.md` — how to test for real.
- `docs/changes/` — per-track notes, so parallel sessions never edit the same
  summary file.

Merging: with CI green and behaviour verified, merge. Stop and ask first for a
destructive migration, a permissions change, or anything hard to undo.
