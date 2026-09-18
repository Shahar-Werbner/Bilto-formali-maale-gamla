// Parsing a pasted roster. Staff arrive with a list in a spreadsheet, a
// WhatsApp message or a printed page, so the input is whatever they could
// copy — the parser's job is to make the common shapes work without asking
// them to reformat anything.

export type ImportRow = {
  name: string;
  grade: string | null;
  parentName: string | null;
  parentPhone: string | null;
};

export type ParseResult = {
  rows: ImportRow[];
  /** 1-based line numbers that held something but produced no usable row. */
  skipped: number[];
};

// Columns, in order. Everything past the name is optional.
const COLUMNS = ["name", "grade", "parentName", "parentPhone"] as const;

// A header line people often paste along with the data.
const HEADERS = new Set([
  "שם",
  "name",
  "שם מלא",
  "שם הילד",
  "שם הילד/ה",
]);

// Splits one line into fields. Handles comma, tab and semicolon separators,
// and double-quoted fields (a spreadsheet quotes any value containing a comma).
function splitFields(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // "" inside a quoted field is a literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (ch === "," || ch === "\t" || ch === ";")) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((f) => f.trim());
}

// Phone numbers are pasted as 050-123-4567, 050 1234567, +972... — keep the
// digits and a leading +, drop the decoration so they compare and dial alike.
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return (plus ? "+" : "") + digits;
}

// Two spellings of the same child should collide: extra spaces, a trailing
// quote mark, different apostrophes.
export function normalizeName(name: string): string {
  return name
    .replace(/[‘’'`״"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseRoster(text: string): ParseResult {
  const rows: ImportRow[] = [];
  const skipped: number[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return; // blank lines are not a problem worth reporting

    const fields = splitFields(line);
    const name = fields[0] ?? "";
    if (!name) {
      skipped.push(index + 1);
      return;
    }
    // A pasted header row is not a child.
    if (HEADERS.has(name.trim().toLowerCase())) return;

    const get = (col: (typeof COLUMNS)[number]) => {
      const value = fields[COLUMNS.indexOf(col)] ?? "";
      return value.trim() || null;
    };

    rows.push({
      name: name.replace(/\s+/g, " ").trim(),
      grade: get("grade"),
      parentName: get("parentName"),
      parentPhone: get("parentPhone")
        ? normalizePhone(get("parentPhone")!)
        : null,
    });
  });

  return { rows, skipped };
}

// Splits parsed rows against the names already in the system. `duplicate`
// covers both children who already exist and repeats within the paste itself —
// importing the same list twice should add nobody.
export function partitionByExisting(
  rows: ImportRow[],
  existingNames: string[],
): { fresh: ImportRow[]; duplicate: ImportRow[] } {
  const seen = new Set(existingNames.map(normalizeName));
  const fresh: ImportRow[] = [];
  const duplicate: ImportRow[] = [];

  for (const row of rows) {
    const key = normalizeName(row.name);
    if (seen.has(key)) {
      duplicate.push(row);
    } else {
      seen.add(key);
      fresh.push(row);
    }
  }
  return { fresh, duplicate };
}
