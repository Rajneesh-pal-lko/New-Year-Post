// Business facts shown on the policy pages and footer.
//
// OWNER TO FILL IN before Razorpay live activation. Anything left as null is
// rendered as a highlighted "to be confirmed" placeholder so it cannot be
// mistaken for a real fact. Do not guess these values: legal entity, address,
// GST status and refund terms must come from the actual business setup.

export const business = {
  brandName: "Pigeon Post 2027",
  /** Registered legal name of the business or proprietor. */
  legalName: null as string | null,
  /** Registered address shown on Contact and Terms. */
  address: null as string | null,
  /** Support email shown publicly and used as reply-to. */
  supportEmail: null as string | null,
  /** Optional support phone. */
  supportPhone: null as string | null,
  /** Grievance officer name + email (privacy policy). */
  grievanceOfficer: null as string | null,
  /** Governing law / jurisdiction city for the terms. */
  jurisdictionCity: null as string | null,
  /** true / false once confirmed; null until then. */
  gstRegistered: null as boolean | null,
  gstin: null as string | null,
  /** Days after 1 Jan 2027 when private data (emails, messages) is deleted. Q15. */
  dataRetentionDays: null as number | null,
  /**
   * Refund and cancellation policy (open question Q8). Leave null until the
   * owner decides; the refunds page then shows the placeholder.
   */
  refundPolicy: null as null | {
    beforeDelivery: string;
    afterDelivery: string;
    failedDelivery: string;
    duplicatePayment: string;
    refundTimeline: string;
  },
  /** Date the policies were last updated, e.g. "1 December 2026". */
  policiesUpdated: null as string | null,
};

export function isBusinessInfoComplete(): boolean {
  const b = business;
  return Boolean(
    b.legalName && b.address && b.supportEmail && b.grievanceOfficer && b.jurisdictionCity &&
      b.gstRegistered !== null && b.dataRetentionDays && b.refundPolicy && b.policiesUpdated,
  );
}
