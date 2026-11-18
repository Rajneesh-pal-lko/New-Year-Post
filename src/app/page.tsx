import Link from "next/link";
import { formatRupees } from "@shared/money";
import { SLOTS, slotToUtc } from "@shared/slots";
import { Countdown } from "@/components/Countdown";
import { Bunting } from "@/components/Decorations";
import { Pigeon } from "@/components/Pigeon";
import { PriceNote } from "@/components/PriceNote";
import { PriceStamps } from "@/components/PriceStamps";
import { RevealStage } from "@/components/RevealStage";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { deliveryDate, now } from "@/lib/campaign";
import { pricingView } from "@/lib/pricing";

// Prices and the countdown depend on the server clock, so this page is rendered per request.
export const dynamic = "force-dynamic";

const EXAMPLE = {
  recipientName: "Didi",
  senderName: "Chotu",
  message:
    "Happy New Year, Didi!\n\nThank you for every late-night chai and for always picking up when I call. 2027 is going to be a good one. I can feel it.\n\nSee you at Holi?",
};

// The 48 delivery slots, shown as four six-hour rows of twelve.
const DAY_PARTS = [
  { key: "night", label: "Midnight to 6 AM" },
  { key: "morning", label: "6 AM to noon" },
  { key: "afternoon", label: "Noon to 6 PM" },
  { key: "evening", label: "6 PM to midnight" },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Do I need an account?",
    a: "No. You pay once, and we email you a private link where you can check on every pigeon.",
  },
  {
    q: "When exactly will my pigeons arrive?",
    a: "On 1 January 2027, in India time (IST). You pick a half-hour slot for each pigeon, anywhere from 12:00 AM to 11:30 PM. If many pigeons share a slot, some may land a few minutes after it starts.",
  },
  {
    q: "How does the recipient get it?",
    a: "By email. At the time you picked, they get a short email saying a pigeon has arrived from you. The link opens the pigeon and your letter. The message itself is never in the email.",
  },
  {
    q: "Can I write in Hindi or other languages?",
    a: "Yes. Write in any language or script, with emoji if you like. Each letter can be up to 500 characters.",
  },
  {
    q: "Can anyone else read my letter?",
    a: "Only the person you send it to. After reading, they can choose to release the pigeon into the public Pigeon Universe. That only happens if you allowed it at checkout, and every released letter is reviewed before it appears. Email addresses are never shown.",
  },
  {
    q: "How do I pay?",
    a: "Through Razorpay: UPI, cards, netbanking and wallets. We never see or store your card details. Checkout is for customers in India, in rupees.",
  },
  {
    q: "What if an email can't be delivered?",
    a: "Your order page shows each pigeon's real status: scheduled, sent, delivered or failed. We only say “delivered” when the email service confirms it.",
  },
];

export default function HomePage() {
  const at = now();
  const view = pricingView(at);
  const one = view.packages.find((p) => p.size === 1)!;
  const midnight = slotToUtc(deliveryDate(), "00:00");

  return (
    <>
      <section className="hero band band--pink">
        <Bunting />
        <SiteHeader />
        <div className="hero__inner">
          <div className="lockup">
            <p className="lockup__greeting">Happy New Year</p>
            <p className="lockup__year" aria-label="2027">
              {["2", "0", "2", "7"].map((digit, i) => (
                <span key={i} className={`year-stamp year-stamp--${i + 1}`} aria-hidden>
                  <span>{digit}</span>
                </span>
              ))}
              <Pigeon pose="fly" className="lockup__flyer" />
              <Pigeon pose="perch" className="lockup__percher" />
            </p>
          </div>

          <h1 className="hero__title">
            A little bird.
            <br />
            A special message.
          </h1>
          <p className="hero__lead">Send a pigeon. Make someone&rsquo;s New Year memorable.</p>
          <p className="hero__detail">
            Write a personal letter for each person you love. On 1 January 2027 a pigeon carries it to their inbox, at the
            time you choose.
          </p>
          <div className="hero__actions">
            <Link href="/send" className="button button--gold">
              Send Your First Pigeon
            </Link>
            <Link href="/universe" className="button button--ghost">
              Explore the Pigeon Universe
            </Link>
          </div>
          <p className="hero__price">
            {view.state === "BEFORE" && <>Sales open 1 December. One pigeon will cost {formatRupees(one.amountPaise)}.</>}
            {view.state === "OPEN" && <>One pigeon costs {formatRupees(one.amountPaise)} right now.</>}
            {view.state === "CLOSED" && <>Sales are closed. The pigeons are flying on 1 January.</>}
          </p>
          <Countdown serverNowMs={at.getTime()} targetMs={midnight.getTime()} label="midnight, 1 January 2027 (IST)" />
        </div>
      </section>

      <main>
        <section className="band band--marigold" aria-labelledby="how">
          <div className="band__inner">
            <h2 id="how" className="band__title">
              How it works
            </h2>
            <ol className="steps">
              <li>
                <h3>Pick a bundle</h3>
                <p>1, 3, 5, 10 or 20 pigeons. Each pigeon carries one letter to one person.</p>
              </li>
              <li>
                <h3>Write each letter</h3>
                <p>Up to 500 characters each, in any language. Choose when each one lands on 1 January.</p>
              </li>
              <li>
                <h3>Pay once</h3>
                <p>UPI, cards or netbanking through Razorpay. No account, no app.</p>
              </li>
              <li>
                <h3>They land on New Year&rsquo;s Day</h3>
                <p>Each person gets an email. Opening it lets the pigeon fly in and hand over your letter.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="band band--sky" aria-labelledby="example">
          <div className="band__inner band__inner--split">
            <div>
              <h2 id="example" className="band__title">
                See a pigeon land
              </h2>
              <p className="band__text">
                This is what your recipient sees when they open the email: a pigeon, an envelope, and a little celebration. The
                letter is an example we wrote to show the experience.
              </p>
            </div>
            <div className="example-frame">
              <RevealStage demo {...EXAMPLE} />
            </div>
          </div>
        </section>

        <section className="band band--blush" id="prices" aria-labelledby="pricing">
          <div className="band__inner">
            <h2 id="pricing" className="band__title">
              Pigeon bundles
            </h2>
            <PriceStamps packages={view.packages} />
            <PriceNote view={view} />
            {view.state !== "CLOSED" && (
              <p>
                <Link href="/send" className="button button--primary">
                  Send Your First Pigeon
                </Link>
              </p>
            )}
          </div>
        </section>

        <section className="band band--peacock" aria-labelledby="when">
          <div className="band__inner band__inner--split">
            <div>
              <h2 id="when" className="band__title">
                When your pigeons land
              </h2>
              <div className="prose">
                <p>
                  Every pigeon lands on <strong>1 January 2027</strong>, in Indian Standard Time. Pick a half-hour for each one:
                  the stroke of midnight, breakfast, or their evening chai.
                </p>
                <p>
                  Until then your letters stay sealed. Not even the pigeon pages you share on WhatsApp show the message. After
                  you pay, a private link lets you watch each pigeon go from scheduled, to sent, to delivered.
                </p>
              </div>
            </div>
            <figure className="day-strip" aria-label="48 half-hour delivery slots on 1 January 2027">
              {DAY_PARTS.map((part, row) => (
                <div className={`day-strip__row day-strip__row--${part.key}`} key={part.key}>
                  <span className="day-strip__label">{part.label}</span>
                  <span className="day-strip__dots" aria-hidden>
                    {SLOTS.slice(row * 12, row * 12 + 12).map((s) => (
                      <span key={s} className={s === "00:00" ? "is-midnight" : s.endsWith(":00") ? "is-hour" : undefined} />
                    ))}
                  </span>
                </div>
              ))}
              <figcaption>Each dot is a half-hour slot. Big dots are on the hour.</figcaption>
            </figure>
          </div>
        </section>

        <section className="band band--paper" aria-labelledby="faq">
          <div className="band__inner">
            <h2 id="faq" className="band__title">
              Questions
            </h2>
            <div className="faq">
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="band band--green" aria-labelledby="privacy">
          <div className="band__inner">
            <h2 id="privacy" className="band__title">
              Your letters are private
            </h2>
            <ul className="trust">
              <li>
                <strong>Payments by Razorpay</strong>
                We never see or store card or UPI details.
              </li>
              <li>
                <strong>No accounts</strong>
                We ask only for names, email addresses and your letters.
              </li>
              <li>
                <strong>Private links</strong>
                Each letter opens only through its own long, unguessable link.
              </li>
              <li>
                <strong>Nothing public without consent</strong>A letter goes public only if you allow it, the recipient chooses
                it, and we review it. Email addresses are never published.
              </li>
            </ul>
            <p className="band__text">
              Read the <Link href="/privacy">privacy policy</Link> or <Link href="/contact">contact us</Link>.
            </p>
          </div>
        </section>

        {view.state !== "CLOSED" && (
          <section className="band band--pink finale" aria-labelledby="finale">
            <Pigeon pose="fly" className="finale__pigeon" />
            <h2 id="finale">Who should hear from you first in 2027?</h2>
            <p>Write them a letter tonight. A pigeon will deliver it on New Year&rsquo;s Day, at the time you choose.</p>
            <Link href="/send" className="button button--gold">
              Send Your First Pigeon
            </Link>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
