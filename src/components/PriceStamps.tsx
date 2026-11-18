import { formatRupees } from "@shared/money";
import type { PackageView } from "@/lib/pricing";

// Package prices drawn as postage stamps: the denomination is the price.

export function PriceStamp({ pkg, selected }: { pkg: PackageView; selected?: boolean }) {
  return (
    <span className={`stamp${pkg.recommended ? " stamp--recommended" : ""}${selected ? " stamp--selected" : ""}`}>
      <span className="stamp__frame">
        {pkg.recommended && <span className="stamp__tag">Recommended</span>}
        <span className="stamp__count">
          {pkg.size} {pkg.size === 1 ? "pigeon" : "pigeons"}
        </span>
        <span className="stamp__price">{formatRupees(pkg.amountPaise)}</span>
        <span className="stamp__each">
          {pkg.size === 1 ? "one message" : `about ${formatRupees(pkg.approxPerPigeonPaise)} each`}
        </span>
      </span>
    </span>
  );
}

export function PriceStamps({ packages }: { packages: PackageView[] }) {
  return (
    <ul className="stamps" aria-label="Pigeon bundles">
      {packages.map((pkg) => (
        <li key={pkg.size}>
          <PriceStamp pkg={pkg} />
        </li>
      ))}
    </ul>
  );
}
