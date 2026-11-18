import Link from "next/link";
import { business } from "@/content/business";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Pigeon Post 2027 home">
        <span className="brand__name">Pigeon Post</span>
        <span className="brand__year">2027</span>
      </Link>
      <nav className="site-header__nav" aria-label="Main">
        <Link href="/universe">Universe</Link>
        <Link href="/send" className="site-header__send">
          Send a pigeon
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p className="site-footer__brand">
          Pigeon Post <span>2027</span>
        </p>
        <p className="site-footer__tagline">A little bird. A special message.</p>
        <nav aria-label="Policies and contact" className="site-footer__links">
          <Link href="/about">About</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Cancellations and refunds</Link>
        </nav>
        <p className="site-footer__note">
          Prices are in Indian rupees and include applicable taxes. Payments are processed by Razorpay. Service available in India.
        </p>
        {business.legalName && <p className="site-footer__note">Operated by {business.legalName}.</p>}
      </div>
    </footer>
  );
}

/** A clearly marked gap in business information that the owner must fill in. */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return <mark className="placeholder">[To be confirmed: {children}]</mark>;
}
