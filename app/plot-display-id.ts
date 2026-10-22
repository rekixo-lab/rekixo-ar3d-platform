/** Customer-facing plot identity, never a shop category or plot prefix for B/C series. */
export function displayPlotId(id: string): string {
  const clean = String(id || "").trim();
  return /^[BC][0-9]+$/i.test(clean) ? clean : `Plot ${clean}`;
}
