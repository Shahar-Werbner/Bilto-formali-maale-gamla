import { NextResponse } from "next/server";
import { requireCapability, sessionCan } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-error";
import { isRecordId } from "@/lib/registration";
import {
  registrationErrorResponse,
  reviewRegistration,
} from "@/lib/registration-server";

// POST /api/registrations/<id> — an adult decides on a registration (item 8).
// Body: { action: "approve" | "reject", applyChanges?: boolean, applyContact?: boolean }
//
// applyChanges writes "goes home alone" and a new pickup person onto the child
// — deciding who may take a child home, so it also needs dismissal:authorize.
// applyContact replaces the phone on file, so it also needs roster:contacts.
// Both default to false: approving a registration changes nothing about going
// home unless the adult chose that.
//
// Scoping: reviewRegistration() resolves the registration through its form's
// event with LIVE_EVENT (src/lib/event-scope.ts) and refuses a deleted child.
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { session, response } = await requireCapability("registration:manage");
  if (response) return response;

  try {
    if (!isRecordId(params.id)) {
      return NextResponse.json({ error: "ההרשמה לא נמצאה" }, { status: 404 });
    }
    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
    }
    const applyChanges = body?.applyChanges === true;
    const applyContact = body?.applyContact === true;

    if (applyChanges && !(await sessionCan("dismissal:authorize"))) {
      return NextResponse.json({ error: "אין לך הרשאה לשנות מי אוסף" }, { status: 403 });
    }
    if (applyContact && !(await sessionCan("roster:contacts"))) {
      return NextResponse.json({ error: "אין לך הרשאה לשנות פרטי קשר" }, { status: 403 });
    }

    const result = await reviewRegistration(
      params.id,
      { action, applyChanges, applyContact },
      session.user.id,
    );
    return NextResponse.json(result);
  } catch (err) {
    return registrationErrorResponse(err) ?? handleApiError(err);
  }
}
