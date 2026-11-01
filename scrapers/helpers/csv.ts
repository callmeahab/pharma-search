export function parseCSVRecords(content: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}


export const CSV_HEADER_LEGACY = 'title,price,category,link,thumbnail,photos,vendor,scrapedAt';
export const CSV_HEADER_V2 = `${CSV_HEADER_LEGACY},availability,sourceProductId,gtin`;
export function validSnapshot(records: string[][]): boolean {
  const header = records[0]?.join(',');
  const width = header === CSV_HEADER_V2 ? 11 : header === CSV_HEADER_LEGACY ? 8 : 0;
  return width > 0 && records.slice(1).every(row => row.length === width);
}
// Keep variant selectors while removing marketing identifiers. Matches Go rebuild.
export function sourceProductID(link: string): string {
  try {
    const url = new URL(link.trim());
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key === 'fbclid' || key === 'gclid') url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return link.trim(); }
}
