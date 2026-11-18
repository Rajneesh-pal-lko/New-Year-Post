import Link from "next/link";
import { formatRupees } from "@shared/money";
import { Pigeon } from "@/components/Pigeon";
import { PriceNote } from "@/components/PriceNote";
import { PriceStamps } from "@/components/PriceStamps";
import { RevealStage } from "@/components/RevealStage";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { now } from "@/lib/campaign";
import { pricingView } from "@/lib/pricing";

// Prices depend on the server clock, so this page is rendered per request.
export const dynamic = "force-dynamic";

const EXAMPLE = {
  recipientName: "Didi",
  senderName: "Chotu",
  message:
    "Happy New Year, Didi!\n\nThank you for every late-night chai and for always picking up when I call. 2027 is going to be a good one. I can feel it.\n\nSee you at Holi?",
};

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
    a: "Yes. Write in any language or script, with emoji if you like. Each message can be up to 500 characters.",
  },
  {
    q: "Can anyone else read my message?",
    a: "Only the person you send it to. After reading, they can choose to release the pigeon into the public Pigeon Universe. That only happens if you allowed it at checkout, and every released message is reviewed before it appears. Email addresses are never shown.",
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
  const view = pricingView(now());
  const one = view.packages.find((p) => p.size === 1)!;

  return (
    <>
      <section className="hero">
        <SiteHeader tone="night" />
        <div className="hero__inner">
          <div className="hero__scene" aria-hidden>
            <span className="hero__stars" />
            <span className="hero__wire" />
            <Pigeon pose="fly" className="hero__flyer" />
            <Pigeon pose="perch" className="hero__percher" />
          </div>
          <div className="hero__copy">
            <h1 className="hero__title">
              A little bird.
              <br />
              A special message.
            </h1>
            <p className="hero__lead">Send a pigeon. Make someone&rsquo;s New Year memorable.</p>
            <p className="hero__detail">
              Write a personal note for each person you love. Your pigeons land in their inbox on 1 January 2027, at the time you
              choose.
            </p>
            <div className="hero__actions">
              <Link href="/send" className="button button--primary">
                Send Your First Pigeon
              </Link>
              <Link href="/universe" className="button button--ghost-light">
                Explore the Pigeon Universe
              </Link>
            </div>
            <p className="hero__price">
              {view.state === "BEFORE" && <>Sales open 1 December. One pigeon will cost {formatRupees(one.amountPaise)}.</>}
              {view.state === "OPEN" && <>One pigeon costs {formatRupees(one.amountPaise)} right now.</>}
              {view.state === "CLOSED" && <>Sales are closed. Pigeons are flying on 1 January.</>}
            </p>
          </div>
        </div>
        <div className="airmail-edge" aria-hidden />
      </section>

      <main>
        <section className="section" aria-labelledby="how">
          <div className="section__inner">
            <h2 id="how" className="section__title">
              How it works
            </h2>
            <ol className="steps">
              <li>
                <h3>Pick a bundle</h3>
                <p>1, 3, 5, 10 or 20 pigeons. Each pigeon carries one message to one person.</p>
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

        <section className="section section--sheet" aria-labelledby="example">
          <div className="section__inner section__inner--split">
            <div>
              <h2 id="example" className="section__title">
                See a pigeon land
              </h2>
              <p className="section__text">
                This is what your recipient sees when they open the email. The letter below is an example we wrote to show the
                experience.
              </p>
            </div>
            <div className="example-frame">
              <RevealStage demo {...EXAMPLE} />
            </div>
          </div>
        </section>

        <section className="section" id="prices" aria-labelledby="pricing">
          <div className="section__inner">
            <h2 id="pricing" className="section__title">
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

        <section className="section section--sheet" aria-labelledby="when">
          <div className="section__inner section__inner--split">
            <h2 id="when" className="section__title">
              When your pigeons land
            </h2>
            <div className="prose">
              <p>
                Every pigeon lands on <strong>1 January 2027</strong>, in Indian Standard Time. You choose a half-hour slot for
                each one, from 12:00 AM (the stroke of midnight) to 11:30 PM, so a pigeon can wake someone up with your wishes
                or arrive with their evening chai.
              </p>
              <p>
                Until then, your letters stay sealed. Not even the pigeon pages you share on WhatsApp show the message. After
                you pay, you get a private link to watch each pigeon go from scheduled, to sent, to delivered.
              </p>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="faq">
          <div className="section__inner">
            <h2 id="faq" className="section__title">
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

        <section className="section section--sheet" aria-labelledby="privacy">
          <div className="section__inner section__inner--split">
            <h2 id="privacy" className="section__title">
              Your letters are private
            </h2>
            <ul className="trust">
              <li>
                <strong>Payments by Razorpay.</strong> We never see or store card or UPI details.
              </li>
              <li>
                <strong>No accounts.</strong> We ask only for names, email addresses and your messages.
              </li>
              <li>
                <strong>Private links.</strong> Each letter opens only through its own long, unguessable link.
              </li>
              <li>
                <strong>Nothing public without consent.</strong> A letter goes public only if you allow it, the recipient
                chooses it, and we review it. Email addresses are never published.
              </li>
            </ul>
            <p className="section__text">
              Read the <Link href="/privacy">privacy policy</Link> or <Link href="/contact">contact us</Link>.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
