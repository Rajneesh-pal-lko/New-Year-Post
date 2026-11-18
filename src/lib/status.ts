// What we tell people about a pigeon. Honest wording: "sent" only once the
// email provider accepted it, "delivered" only when the provider reports the
// receiving mail server took it.

export type PigeonStatus =
  | "PENDING_PAYMENT"
  | "SCHEDULED"
  | "PROCESSING"
  | "EMAIL_ACCEPTED"
  | "DELIVERED_BY_PROVIDER"
  | "FAILED"
  | "CANCELLED";

export function pigeonStatusLabel(status: string): { label: string; tone: "waiting" | "good" | "bad" | "neutral" } {
  switch (status) {
    case "PENDING_PAYMENT":
      return { label: "Waiting for payment", tone: "waiting" };
    case "SCHEDULED":
      return { label: "Scheduled", tone: "neutral" };
    case "PROCESSING":
      return { label: "Taking off now", tone: "waiting" };
    case "EMAIL_ACCEPTED":
      return { label: "Sent, waiting for delivery confirmation", tone: "good" };
    case "DELIVERED_BY_PROVIDER":
      return { label: "Delivered to their inbox provider", tone: "good" };
    case "FAILED":
      return { label: "Could not be delivered", tone: "bad" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "bad" };
    default:
      return { label: status, tone: "neutral" };
  }
}
