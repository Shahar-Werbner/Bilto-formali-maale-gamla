import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import { REGISTRATION_WRITE_LIMIT, parseSubmission } from "@/lib/registration";
import {
  registrationErrorResponse,
  resolveRegistrationForm,
  submitRegistration,
} from "@/lib/registration-server";

// The registration form's endpoint (item 8). **An unauthenticated write about
// minors**, and the link it hangs on is posted to a WhatsApp group — so it
// identifies nobody, and anyone holding it can answer for any child.
//
// What stands between that and a six-year-old's record:
//   - the token is shape-checked before any query, and the route is throttled;
//   - a closed form (deadline passed, closed by hand, link reissued) refuses
//     before reading the body;
//   - the body is parsed whole, against the days this form actually offers;
//   - what a submission may change on its own is the coming/food answers.
//     "Goes home alone", a new pickup person, a phone number and a new child
//     all wait for an adult (src/lib/registration.ts), and the answer here is
//     the same whether anything was queued or not.
//
// There is no GET: the page renders the form server-side, under the same
// throttle, and this route has nothing to read back.

function callerIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// POST /api/registration/<token>
// Body: { children: [{ participantId? | newChild: {name, grade}, parentName,
//         parentPhone, dismissal, pickup?: {name, relation?, phone},
//         days: [{eventDayId, coming, bringsFood?}], note?, equipmentAck }] }
export async function POST(
  request: Request,
  { params }: { params: { token: string } },
) {
  if (REGISTRATION_WRITE_LIMIT.check(callerIp(request))) {
    return NextResponse.json(
      { error: "יותר מדי שליחות. נסו שוב בעוד כמה דקות." },
      { status: 429 },
    );
  }

  try {
    const resolved = await resolveRegistrationForm(params.token);
    if (resolved.state === "unknown") {
      return NextResponse.json({ error: "הקישור לא נמצא" }, { status: 404 });
    }
    if (resolved.state !== "open") {
      return NextResponse.json(
        { error: "ההרשמה נסגרה", closed: true },
        { status: 410 },
      );
    }
    const { form } = resolved;

    const body = await request.json().catch(() => null);
    const parsed = parseSubmission(
      body,
      form.days.map((d) => d.id),
      {
        equipmentRequired:
          form.equipment.length > 0 || form.days.some((d) => d.equipment.length > 0),
      },
    );
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const results = await submitRegistration(form, parsed.children);
    return NextResponse.json({ results });
  } catch (err) {
    return registrationErrorResponse(err) ?? handleApiError(err);
  }
}
