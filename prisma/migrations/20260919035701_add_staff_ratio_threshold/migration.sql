-- The one thing item 4's spec needs that the schema session for items 2-4 did
-- not land: it calls for a ratio alert "below a configurable threshold" without
-- saying where that threshold lives. Without a column, item 4 would have had to
-- come back for a migration of its own, which is exactly what landing the
-- schema ahead of the parallel tracks exists to avoid.
--
-- Nullable on purpose: null means fall back to the app-wide default, so this
-- costs nothing until someone sets it. A camp and a Tuesday afternoon can want
-- different numbers, so it is per event rather than global.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "maxChildrenPerStaff" INTEGER;
