/**
 * Dependency-free CSV parser. Handles quoted fields, escaped quotes ("" inside
 * a quoted field), embedded commas/newlines, and trailing whitespace. Returns
 * an array of row objects keyed by the header row. Header keys are trimmed.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];

  const header = (rows[0] ?? []).map((h) => h.trim());
  const out: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    // Skip fully empty trailing lines.
    if (cells.length === 1 && (cells[0] ?? '').trim() === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      obj[key] = (cells[c] ?? '').trim();
    }
    out.push(obj);
  }
  return out;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // handle \r\n and lone \r
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // flush last field/row if there is any pending content
  if (field !== '' || row.length > 0) {
    pushRow();
  }
  return rows;
}
