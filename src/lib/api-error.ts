import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

// Every route handler funnels its failures through here. Without it an unknown
// id (a stale tab, a row someone else just deleted) surfaces as an unhandled
// Prisma exception — a 500 with a stack trace instead of something the UI can
// show the user.
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2025": // record required by the operation was not found
        return NextResponse.json({ error: "הפריט לא נמצא" }, { status: 404 });
      case "P2002": // unique constraint
        return NextResponse.json({ error: "הפריט כבר קיים" }, { status: 409 });
      case "P2003": // foreign key constraint
        return NextResponse.json(
          { error: "הפנייה לפריט שאינו קיים" },
          { status: 400 },
        );
    }
  }
  console.error("[api]", err);
  return NextResponse.json({ error: "שגיאת שרת" }, { status: 500 });
}
