// CSV generation for the list exports (§6.2 of the design system).
//
// Three things this has to get right, all of them about Excel specifically, because Excel is what a
// Saudi property office actually opens the file in:
//
//   1. A UTF-8 BOM. Without it Excel reads the bytes as the local ANSI codepage and every Arabic
//      name becomes mojibake. This single character is the difference between a usable export and
//      a support ticket.
//   2. CRLF line endings, which Excel expects.
//   3. A guard against formula injection: a cell beginning with = + - @ or a control character is
//      executed by Excel as a formula when opened. Tenant names and notes are user input, so this
//      is a real path from "someone typed a name" to "a formula ran on the accountant's machine".

const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value == null) return "";
  let text = String(value);

  // Prefixing with a single quote is what Excel reads as "this is literal text". The quote is not
  // shown in the cell, so the export stays readable.
  if (FORMULA_TRIGGERS.test(text)) text = "'" + text;

  // A field containing a quote, comma, or newline must be quoted, and inner quotes doubled.
  if (/["',\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => unknown;
};

/** Rows + column definitions → a CSV string Excel opens correctly, BOM included. */
export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const lines = [
    columns.map((c) => cell(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => cell(c.value(row))).join(",")),
  ];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/**
 * A download response for a CSV body. The filename carries the date so a folder of exports stays
 * sortable, and stays ASCII so no browser has to guess at the encoding of the header itself.
 */
export function csvResponse(csv: string, basename: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${basename}-${stamp}.csv"`,
      // An export is a snapshot of live data; a cached copy would be a wrong one.
      "Cache-Control": "no-store",
    },
  });
}
