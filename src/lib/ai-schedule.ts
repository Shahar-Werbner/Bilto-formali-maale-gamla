import Anthropic from "@anthropic-ai/sdk";

// Model is configurable so cost can be tuned without a code change
// (e.g. AI_MODEL=claude-haiku-4-5 for a much cheaper option).
const MODEL = process.env.AI_MODEL || "claude-opus-5";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ParsedSlot = {
  startTime: string;
  endTime: string | null;
  title: string;
  location: string | null;
  groupName: string | null;
  notes: string | null;
};

// JSON schema for structured output. All fields are strings ("" = not provided)
// to keep the strict schema simple.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    slots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          startTime: { type: "string", description: "שעת התחלה HH:mm (24 שעות)" },
          endTime: { type: "string", description: "שעת סיום HH:mm, או ריק" },
          title: { type: "string", description: "שם הפעילות, בעברית, תמציתי" },
          location: { type: "string", description: "מיקום, או ריק" },
          notes: { type: "string", description: "הערות, או ריק" },
          group: {
            type: "string",
            description: "שם קבוצה מדויק מתוך הרשימה שסופקה, או ריק אם הפעילות לכל האירוע",
          },
        },
        required: ["startTime", "endTime", "title", "location", "notes", "group"],
      },
    },
  },
  required: ["slots"],
} as const;

function systemPrompt(groupNames: string[], dateLabel?: string): string {
  const groups =
    groupNames.length > 0
      ? `שמות הקבוצות הקיימות (השתמש רק בשם מדויק מתוך הרשימה, אחרת השאר ריק): ${groupNames.join(", ")}.`
      : "אין קבוצות מוגדרות — השאר את שדה הקבוצה ריק תמיד.";

  return [
    "אתה עוזר שמסדר תכנון פעילויות של חינוך בלתי פורמלי ללוז יומי מובנה.",
    "המשתמש נותן תיאור חופשי או קובץ עם פעילויות. חלץ כל פעילות כ'סלוט' עם:",
    "startTime (HH:mm, 24 שעות), endTime (אם צויין), title (תמציתי בעברית),",
    "location (אם צויין), notes (אם רלוונטי), group (אם הפעילות ייעודית לקבוצה).",
    dateLabel ? `היום המדובר: ${dateLabel}.` : "",
    groups,
    "אם לא צויינה שעה מפורשת, שערך רצף שעות סביר לפי הסדר. שמור על הסדר הכרונולוגי.",
    "החזר אך ורק לפי הסכמה. אל תמציא פעילויות שלא הופיעו.",
  ]
    .filter(Boolean)
    .join(" ");
}

type UserContent =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

// Calls Claude to turn free text (and/or a PDF) into structured schedule slots.
export async function parseSchedule(opts: {
  text?: string;
  pdfBase64?: string;
  groupNames: string[];
  dateLabel?: string;
}): Promise<ParsedSlot[]> {
  const client = new Anthropic();

  const content: UserContent[] = [];
  if (opts.pdfBase64) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: opts.pdfBase64,
      },
    });
  }
  content.push({
    type: "text",
    text:
      (opts.text?.trim() || "סדר את הפעילויות מהקובץ המצורף.") +
      "\n\nהחזר את הפעילויות כלוז מסודר.",
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt(opts.groupNames, opts.dateLabel),
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [{ role: "user", content }],
    // output_config typings can lag the API; cast keeps us to the current shape.
  } as Anthropic.MessageCreateParamsNonStreaming);

  if (response.stop_reason === "refusal") {
    throw new Error("הבקשה נדחתה על ידי המודל");
  }

  const jsonText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("לא הצלחתי לפענח את התשובה");
  }

  const rawSlots = (parsed as { slots?: unknown })?.slots;
  if (!Array.isArray(rawSlots)) return [];

  const clean = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };

  const out: ParsedSlot[] = [];
  for (const s of rawSlots) {
    const startTime = typeof s?.startTime === "string" ? s.startTime.trim() : "";
    const title = typeof s?.title === "string" ? s.title.trim() : "";
    if (!TIME.test(startTime) || !title) continue; // skip unusable rows
    const endTimeRaw = typeof s?.endTime === "string" ? s.endTime.trim() : "";
    out.push({
      startTime,
      endTime: TIME.test(endTimeRaw) ? endTimeRaw : null,
      title,
      location: clean(s?.location),
      notes: clean(s?.notes),
      groupName: clean(s?.group),
    });
  }
  return out;
}
