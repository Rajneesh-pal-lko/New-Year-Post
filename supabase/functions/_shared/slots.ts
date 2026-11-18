// Delivery slots on the delivery day, in IST. Shared by the app and the
// Edge Function. No imports on purpose (runs in Node and Deno).

export const IST_OFFSET_MINUTES = 330; // UTC+05:30, no daylight saving
export const TIMEZONE = "Asia/Kolkata";

/** '00:00', '00:30', ... '23:30' (48 slots) */
export const SLOTS: readonly string[] = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

export function isValidSlot(slot: string): boolean {
  return SLOTS.includes(slot);
}

/** '00:00' -> '12:00 AM', '13:30' -> '1:30 PM' */
export function formatSlot(slot: string): string {
  const [hStr, m] = slot.split(":");
  const h = Number(hStr);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** Friendly label used in the UI and emails. */
export function slotLabel(slot: string): string {
  if (slot === "00:00") return "12:00 AM (midnight)";
  if (slot === "12:00") return "12:00 PM (noon)";
  return formatSlot(slot);
}

/**
 * The UTC instant for a slot on an IST calendar date.
 * slotToUtc('2027-01-01', '00:00') -> 2026-12-31T18:30:00.000Z
 */
export function slotToUtc(istDate: string, slot: string): Date {
  const [y, mo, d] = istDate.split("-").map(Number);
  const [h, mi] = slot.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MINUTES * 60_000);
}

/** '2027-01-01' -> '1 January 2027' */
export function formatIstDate(istDate: string): string {
  const [y, mo, d] = istDate.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${d} ${months[mo - 1]} ${y}`;
}
