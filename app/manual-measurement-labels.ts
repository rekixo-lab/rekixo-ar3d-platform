/**
 * Mapping Controls is an explicit manual-size update. The numeric inputs are
 * authoritative when an older imported label disagrees with them.
 *
 * Preserve genuinely matching exact feet/inches labels (e.g. 33'-8" and
 * 33.6667 ft), so unrelated precision is never needlessly discarded.
 */
function existingLabelLength(label: string, unit: "ft" | "m"): number | null {
  const text = label
    .trim()
    .replace(/[\u2032\u2018\u2019]/g, "'")
    .replace(/[\u2033\u201c\u201d]/g, '"');

  if (unit === "ft") {
    const feetAndInches = text.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:[-–—]\s*)?(\d+(?:\.\d+)?)?\s*(?:"|in(?:ches)?)?\s*$/i);
    if (feetAndInches) {
      const feet = Number(feetAndInches[1]);
      const inches = Number(feetAndInches[2] || 0);
      return inches >= 0 && inches < 12 ? feet + inches / 12 : null;
    }
  }
  const measure = text.match(/^(\d+(?:\.\d+)?)\s*(ft|feet|foot|m|meters?|metres?)$/i);
  if (!measure) return null;
  const parsedUnit = /^(ft|feet|foot)$/i.test(measure[2]) ? "ft" : "m";
  return parsedUnit === unit ? Number(measure[1]) : null;
}

export function syncManualDimensionLabel(
  value: number | null,
  previousValue: number | null | undefined,
  originalLabel: string | null | undefined,
  unit: "ft" | "m",
  previousUnit: string | null | undefined,
): string | null {
  const label = String(originalLabel || "").trim();
  if (value === null) {
    // A deliberate numeric clear removes its stale display override; preserve
    // a label-only imported side where there was never a numeric measurement.
    return previousValue != null ? null : label || null;
  }

  const previousUnitChanged = Boolean(previousUnit) && previousUnit !== unit;
  const parsed = label ? existingLabelLength(label, unit) : null;
  const tolerance = unit === "ft" ? 0.015 : 0.005;
  if (
    label &&
    !previousUnitChanged &&
    parsed !== null &&
    Number.isFinite(parsed) &&
    Math.abs(parsed - value) <= tolerance
  ) {
    return label;
  }
  return `${value} ${unit}`;
}
