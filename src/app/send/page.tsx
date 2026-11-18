import type { Metadata } from "next";
import { formatIstDate } from "@shared/slots";
import { PriceNote } from "@/components/PriceNote";
import { SendFlow } from "@/components/SendFlow";
import { SiteHeader } from "@/components/SiteChrome";
import { deliveryDate, now } from "@/lib/campaign";
import { env } from "@/lib/env";
import { pricingView } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Send a pigeon: Pigeon Post 2027",
};

export default function SendPage() {
  const view = pricingView(now());
  return (
    <>
      <SiteHeader />
      <SendFlow
        packages={view.packages}
        salesState={view.state}
        deliveryDateLabel={formatIstDate(deliveryDate())}
        priceNote={<PriceNote view={view} />}
        checkoutMinutes={env.checkoutTtlMinutes}
      />
    </>
  );
}
