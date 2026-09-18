// Excel rejects worksheet names containing : \ / ? * [ ] and caps them at 31
// characters. Event names are free text ("קייטנה א/ב"), so they have to be
// sanitised or ExcelJS throws and the download turns into a 500.
const ILLEGAL = /[:\\/?*[\]]/g;

export function safeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(ILLEGAL, " ").trim().slice(0, 31).trim();
  return cleaned || fallback;
}

// Content-Disposition for an .xlsx download. The filename is Hebrew, so it goes
// out percent-encoded via filename* (RFC 5987).
export function xlsxHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
      filename,
    )}`,
  };
}
