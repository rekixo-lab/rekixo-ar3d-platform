/**
 * Customer-facing direction disclosure policy.
 * A project-specific presentation filter; source geometry and D1 records stay unchanged.
 */
export const FUTURE_INVEST_REALTY_ID = "ec6b45b5-7232-475a-bba8-468caccfe568";

const SOUTH_DIRECTION = /\b(?:south(?:[\s-]*(?:east|west)|ern)?|s[\s\/-]?[ew])\b|दक्षिण/iu;

export function isFutureInvestRealty(projectId: unknown): boolean {
  return String(projectId || "").trim() === FUTURE_INVEST_REALTY_ID;
}

export function publicSafeText(projectId: unknown, value: unknown): string {
  const text = String(value ?? "");
  return isFutureInvestRealty(projectId) && SOUTH_DIRECTION.test(text) ? "" : text;
}

/** A mixed-facing plot retains its permitted facings; a South-only plot has no public facing. */
export function publicSafeFacing(projectId: unknown, value: unknown): string {
  const text = String(value ?? "").trim();
  if (!isFutureInvestRealty(projectId) || !SOUTH_DIRECTION.test(text)) return text;
  return text
    .split(/\s*(?:·|[,;]|\s+\/\s+|\s+&\s+)\s*/u)
    .filter((part) => part && !SOUTH_DIRECTION.test(part))
    .join(" · ");
}

/** Strip only public-facing manual South overrides from serialized metadata. */
export function publicSafeSideSemantics(projectId: unknown, value: unknown): string {
  const text = String(value ?? "");
  if (!isFutureInvestRealty(projectId) || !SOUTH_DIRECTION.test(text)) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const source = parsed as Record<string, unknown>;
    const raw = source.facingDirectionOverrides;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const allowed = Object.fromEntries(
        Object.entries(raw).filter(([, direction]) => !SOUTH_DIRECTION.test(String(direction))),
      );
      const cleaned = JSON.stringify({ ...source, facingDirectionOverrides: allowed });
      return SOUTH_DIRECTION.test(cleaned) ? "" : cleaned;
    }
  } catch {
    // Invalid legacy metadata is never forwarded with a hidden direction.
  }
  return "";
}
