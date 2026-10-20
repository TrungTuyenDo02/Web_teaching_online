/** Ô CSV: escape dấu nháy và vô hiệu công thức trong dữ liệu người dùng nhập. */
export function csvCell(raw: string | number): string {
  let value = String(raw);
  if (/^[=+\-@]/.test(value.trimStart()) || /^[\t\r\n]/.test(value)) value = `'${value}`;
  return `"${value.replaceAll('"', '""')}"`;
}
