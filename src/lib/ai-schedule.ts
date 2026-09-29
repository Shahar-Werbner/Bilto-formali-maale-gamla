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
  /** The bank activity's exact name, when the model chose one (item 7). */
  activityName: string | null;
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
          activity: {
            type: "string",
            description: "שם מדויק של פעילות ממאגר הפעילויות, אם הסלוט הוא פעילות מהמאגר; אחרת ריק",
          },
        },
        required: ["startTime", "endTime", "title", "location", "notes", "group", "activity"],
      },
    },
  },
  required: ["slots"],
} as const;

// Exported for the test that pins what the model is told about the bank.
export function systemPrompt(
  groupNames: string[],
  dateLabel?: string,
  bankLines: string[] = [],
): string {
  const groups =
    groupNames.length > 0
      ? `שמות הקבוצות הקיימות (השתמש רק בשם מדויק מתוך הרשימה, אחרת השאר ריק): ${groupNames.join(", ")}.`
      : "אין קבוצות מוגדרות — השאר את שדה הקבוצה ריק תמיד.";

  // Item 7: the model proposes from what this team has actually run, best
  // rated first, instead of inventing an activity nobody here has tried. It
  // still does not add activities the plan did not ask for — a gap it may fill
  // is a slot the text left generic ("פעילות חוץ", "יצירה").
  const bank =
    bankLines.length > 0
      ? [
          "מאגר הפעילויות של הצוות (מסודר מהמוצלחת ביותר, לפי דירוגי הצוות):",
          bankLines.join("\n"),
          "כשהתיאור מזכיר פעילות מהמאגר, או משאיר משבצת כללית (למשל 'פעילות חוץ', 'יצירה', 'משחק'), בחר מהמאגר פעילות מתאימה — העדף כאלה שעבדו — כתוב את שמה המדויק בשדה activity ובשדה title.",
          "אל תמציא פעילות חדשה למשבצת כללית כשיש במאגר פעילות מתאימה. פעילות שאינה מהמאגר (ארוחה, הגעה, איסוף) — השאר activity ריק.",
        ].join("\n")
      : "אין מאגר פעילויות — השאר את שדה activity ריק תמיד.";

  return [
    "אתה עוזר שמסדר תכנון פעילויות של חינוך בלתי פורמלי ללוז יומי מובנה.",
    "המשתמש נותן תיאור חופשי או קובץ עם פעילויות. חלץ כל פעילות כ'סלוט' עם:",
    "startTime (HH:mm, 24 שעות), endTime (אם צויין), title (תמציתי בעברית),",
    "location (אם צויין), notes (אם רלוונטי), group (אם הפעילות ייעודית לקבוצה).",
    dateLabel ? `היום המדובר: ${dateLabel}.` : "",
    groups,
    "אם לא צויינה שעה מפורשת, שערך רצף שעות סביר לפי הסדר. שמור על הסדר הכרונולוגי.",
    "החזר אך ורק לפי הסכמה. אל תוסיף פעילויות שלא הופיעו בתיאור.",
    bank,
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
  /** From bankForPrompt() in src/lib/activities.ts. */
  bankLines?: string[];
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
    system: systemPrompt(opts.groupNames, opts.dateLabel, opts.bankLines),
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
      activityName: clean(s?.activity),
    });
  }
  return out;
}
