/** Shared, dependency-free contract for private plot details. Amounts persist in paise. */
export const MAX_BOOKING_AMOUNT_PAISE = 1_000_000_000_000;
export const MAX_PLOT_ADMIN_NAME_LENGTH = 120;

export type PlotAdminDetails = {
  ownerName: string | null;
  bookingAmountPaise: number | null;
  brokerName: string | null;
  revision: number;
  updatedAt: string | null;
};

export type PlotAdminDetailChanges = Partial<Pick<PlotAdminDetails, "ownerName" | "bookingAmountPaise" | "brokerName">>;
export type PlotAdminDetailsPatch = {
  plotId: string;
  expectedRevision: number;
  changes: PlotAdminDetailChanges;
};

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };
const invalid = (error: string): Validation<never> => ({ ok: false, error });
const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function canonicalPlotAdminDetails(row?: Partial<PlotAdminDetails> | null): PlotAdminDetails {
  return {
    ownerName: row?.ownerName ?? null,
    bookingAmountPaise: row?.bookingAmountPaise ?? null,
    brokerName: row?.brokerName ?? null,
    revision: row?.revision ?? 0,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Parse decimal rupees without floating point multiplication or rounding. */
export function parseBookingAmount(value: unknown): Validation<number | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return invalid("Booking amount must be a decimal amount in rupees");
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(trimmed))
    return invalid("Enter a non-negative booking amount with up to 2 decimal places");
  const [rupees, fractional = ""] = trimmed.split(".");
  const paise = Number(rupees) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise > MAX_BOOKING_AMOUNT_PAISE)
    return invalid("Booking amount cannot exceed ₹10,00,00,00,000");
  return { ok: true, value: paise };
}

export function bookingAmountInput(paise: number | null | undefined): string {
  if (paise == null) return "";
  const rupees = Math.floor(paise / 100);
  const fraction = paise % 100;
  return fraction ? `${rupees}.${String(fraction).padStart(2, "0")}` : String(rupees);
}

function parseName(value: unknown, label: string): Validation<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return invalid(`${label} must be text`);
  const trimmed = value.trim();
  if (Array.from(trimmed).length > MAX_PLOT_ADMIN_NAME_LENGTH)
    return invalid(`${label} must be ${MAX_PLOT_ADMIN_NAME_LENGTH} characters or fewer`);
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return invalid(`${label} contains invalid control characters`);
  return { ok: true, value: trimmed || null };
}

export function validatePlotAdminDetailsPatch(body: unknown): Validation<PlotAdminDetailsPatch> {
  if (!plainObject(body) || Object.keys(body).some((key) => !["plotId", "expectedRevision", "changes"].includes(key)))
    return invalid("Invalid plot details request");
  if (typeof body.plotId !== "string" || !body.plotId.trim() || body.plotId.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(body.plotId))
    return invalid("Valid plot ID required");
  if (typeof body.expectedRevision !== "number" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= Number.MAX_SAFE_INTEGER)
    return invalid("Valid expected revision required");
  if (!plainObject(body.changes)) return invalid("Plot details changes required");
  const keys = Object.keys(body.changes);
  if (!keys.length || keys.some((key) => !["ownerName", "bookingAmount", "brokerName"].includes(key)))
    return invalid("Only owner name, booking amount and broker name can be changed");
  const changes: PlotAdminDetailChanges = {};
  for (const key of keys) {
    if (key === "bookingAmount") {
      const amount = parseBookingAmount(body.changes[key]);
      if (!amount.ok) return amount;
      changes.bookingAmountPaise = amount.value;
    } else {
      const name = parseName(body.changes[key], key === "ownerName" ? "Plot owner" : "Broker name");
      if (!name.ok) return name;
      changes[key as "ownerName" | "brokerName"] = name.value;
    }
  }
  return { ok: true, value: { plotId: body.plotId.trim(), expectedRevision: body.expectedRevision, changes } };
}
