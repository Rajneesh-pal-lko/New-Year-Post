import { formatRupees } from "@shared/money";
import { formatIstDay } from "@/lib/campaign";
import type { PricingView } from "@/lib/pricing";

/**
 * The honest price line: which window these prices are for, and exactly when
 * and to what they rise next. No countdowns, no "only N left".
 */
export function PriceNote({ view }: { view: PricingView }) {
  if (view.state === "CLOSED") {
    return <p className="price-note">Sales closed on 31 December 2026 at 11:59 PM IST.</p>;
  }

  const one = view.packages.find((p) => p.size === 1)!;
  const five = view.packages.find((p) => p.size === 5)!;

  return (
    <div className="price-note">
      {view.state === "BEFORE" ? (
        <p>
          Sales open on <strong>1 December 2026 at 12:00 AM IST</strong>. These launch prices apply from 1 to 7 December.
        </p>
      ) : (
        <p>
          Prices for <strong>{view.tier.label}</strong>, including applicable taxes.
        </p>
      )}
      {view.nextChange ? (
        <p>
          On {formatIstDay(new Date(view.nextChange.atIso))} at 12:00 AM IST prices go up: 1 pigeon will be{" "}
          {formatRupees(view.nextChange.packages.find((p) => p.size === 1)!.amountPaise)} (now {formatRupees(one.amountPaise)}) and 5
          pigeons {formatRupees(view.nextChange.packages.find((p) => p.size === 5)!.amountPaise)} (now{" "}
          {formatRupees(five.amountPaise)}). See every window on the <a href="/pricing">pricing page</a>.
        </p>
      ) : (
        <p>These are the final prices. Sales close on 31 December 2026 at 11:59 PM IST.</p>
      )}
    </div>
  );
}
