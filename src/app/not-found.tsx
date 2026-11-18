import Link from "next/link";
import { SiteHeader } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>This page flew away</h1>
        <p className="lede">The link may be incomplete or out of date.</p>
        <p>
          <Link href="/" className="button button--primary">
            Go to the home page
          </Link>
        </p>
      </main>
    </>
  );
}
