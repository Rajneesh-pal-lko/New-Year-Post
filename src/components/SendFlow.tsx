"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatRupees } from "@shared/money";
import { SLOTS, slotLabel } from "@shared/slots";
import type { PackageSize } from "@/lib/packages";
import type { PackageView } from "@/lib/pricing";
import {
  MESSAGE_MAX,
  countGraphemes,
  emailSchema,
  nameSchema,
  pigeonInputSchema,
} from "@/lib/validation";
import { PriceStamp } from "./PriceStamps";

// The purchase flow: package -> letters -> review -> Razorpay Checkout.
//
// Everything here is convenience. The server re-validates every field,
// decides the price from its own clock, and only a server-confirmed captured
// payment activates pigeons. The amount shown in Checkout comes from the
// server's response, not from this component.

type Step = "package" | "letters" | "review";

interface PigeonDraft {
  recipientName: string;
  recipientEmail: string;
  message: string;
  slot: string;
}

interface CreatedOrder {
  orderRef: string;
  accessToken: string;
  razorpayOrderId: string;
  keyId: string;
  amountPaise: number;
  currency: string;
  expiresAt: string;
  checkoutTimeoutSeconds: number;
  inputKey: string;
}

interface Props {
  packages: PackageView[];
  salesState: "BEFORE" | "OPEN" | "CLOSED";
  deliveryDateLabel: string;
  priceNote: React.ReactNode;
  checkoutMinutes: number;
}

const DRAFT_KEY = "pp:draft:v1";
const LAST_ORDER_KEY = "pp:lastOrder:v1";

const emptyPigeon = (slot = "00:00"): PigeonDraft => ({ recipientName: "", recipientEmail: "", message: "", slot });

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (r: any) => void): void };
  }
}

function loadCheckoutScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay]");
    const script = existing ?? document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpay = "1";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    if (!existing) document.body.appendChild(script);
  });
}

export function SendFlow({ packages, salesState, deliveryDateLabel, priceNote, checkoutMinutes }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("package");
  const [size, setSize] = useState<PackageSize | null>(null);
  const [sender, setSender] = useState({ name: "", email: "" });
  const [pigeons, setPigeons] = useState<PigeonDraft[]>([]);
  const [openIndex, setOpenIndex] = useState(0);
  const [allowPublic, setAllowPublic] = useState(true);
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"idle" | "creating" | "checkout" | "verifying">("idle");
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [lastOrder, setLastOrder] = useState<{ orderRef: string; accessToken: string; at: number } | null>(null);
  const restored = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const selected = packages.find((p) => p.size === size) ?? null;
  const canBuy = salesState === "OPEN";

  // Restore a draft (e.g. after the browser reloads the page when switching
  // to a UPI app) and remember any order that was already started.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.pigeons) && packages.some((p) => p.size === d.size)) {
          setSize(d.size);
          setSender(d.sender ?? { name: "", email: "" });
          setPigeons(d.pigeons);
          setAllowPublic(d.allowPublic ?? true);
        }
      }
      const last = localStorage.getItem(LAST_ORDER_KEY);
      if (last) {
        const o = JSON.parse(last);
        if (o?.orderRef && Date.now() - o.at < 6 * 3_600_000) setLastOrder(o);
      }
    } catch {
      // Storage can be unavailable (private mode); the flow still works.
    }
    restored.current = true;
  }, [packages]);

  useEffect(() => {
    if (!restored.current || !size) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ size, sender, pigeons, allowPublic }));
    } catch {}
  }, [size, sender, pigeons, allowPublic]);

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" });
  }, [step]);

  function choosePackage(next: PackageSize) {
    setSize(next);
    setPigeons((current) => {
      const slot = current[0]?.slot ?? "00:00";
      const resized = current.slice(0, next);
      while (resized.length < next) resized.push(emptyPigeon(slot));
      return resized;
    });
    setOpenIndex(0);
  }

  function updatePigeon(index: number, patch: Partial<PigeonDraft>) {
    setPigeons((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    setErrors((e) => {
      const copy = { ...e };
      for (const key of Object.keys(patch)) delete copy[`pigeons.${index}.${key}`];
      return copy;
    });
  }

  function applySlotToAll(slot: string) {
    setPigeons((current) => current.map((p) => ({ ...p, slot })));
    setNotice({ tone: "info", text: `All pigeons will land at ${slotLabel(slot)} IST.` });
  }

  function validateLetters(): boolean {
    const found: Record<string, string> = {};
    const n = nameSchema.safeParse(sender.name);
    if (!n.success) found["sender.name"] = n.error.issues[0].message;
    const e = emailSchema.safeParse(sender.email);
    if (!e.success) found["sender.email"] = e.error.issues[0].message;
    pigeons.forEach((p, i) => {
      const r = pigeonInputSchema.safeParse(p);
      if (!r.success) {
        for (const issue of r.error.issues) {
          const key = `pigeons.${i}.${issue.path.join(".")}`;
          if (!found[key]) found[key] = issue.message;
        }
      }
    });
    setErrors(found);
    const firstBad = pigeons.findIndex((_, i) => Object.keys(found).some((k) => k.startsWith(`pigeons.${i}.`)));
    if (firstBad >= 0) setOpenIndex(firstBad);
    return Object.keys(found).length === 0;
  }

  const inputKey = useMemo(
    () => JSON.stringify({ size, sender, pigeons, allowPublic }),
    [size, sender, pigeons, allowPublic],
  );

  async function createOrder(): Promise<CreatedOrder | null> {
    setBusy("creating");
    setNotice(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageSize: size, sender, allowPublicRelease: allowPublic, acceptTerms: accept, pigeons }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.fieldErrors) {
          setErrors(body.fieldErrors);
          setStep("letters");
        }
        setNotice({ tone: "error", text: body.error ?? "Something went wrong. Please try again." });
        return null;
      }
      const created: CreatedOrder = { ...body, inputKey };
      try {
        localStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ orderRef: created.orderRef, accessToken: created.accessToken, at: Date.now() }));
      } catch {}
      setOrder(created);
      return created;
    } catch {
      setNotice({ tone: "error", text: "We couldn't reach the server. Check your connection and try again." });
      return null;
    } finally {
      setBusy("idle");
    }
  }

  async function pay() {
    if (!selected || !canBuy) return;
    if (!accept) {
      setErrors({ acceptTerms: "Please accept the terms to continue" });
      return;
    }

    // Reuse the open order while its price snapshot is valid and nothing changed.
    let current = order;
    const stillValid = current && current.inputKey === inputKey && new Date(current.expiresAt).getTime() - Date.now() > 60_000;
    if (!stillValid) {
      current = await createOrder();
      if (!current) return;
      if (current.amountPaise !== selected.amountPaise) {
        // The price window changed since this page loaded. Say so before charging.
        setNotice({
          tone: "info",
          text: `Prices changed at midnight. The total for this order is now ${formatRupees(current.amountPaise)}. Tap pay again to continue.`,
        });
        return;
      }
    }
    if (!current) return;

    const ok = await loadCheckoutScript();
    if (!ok || !window.Razorpay) {
      setNotice({ tone: "error", text: "The payment window couldn't load. Check your connection and try again." });
      return;
    }

    const orderForCheckout = current;
    setBusy("checkout");
    const checkout = new window.Razorpay({
      key: orderForCheckout.keyId,
      order_id: orderForCheckout.razorpayOrderId,
      amount: orderForCheckout.amountPaise,
      currency: "INR",
      name: "Pigeon Post 2027",
      description: `${size} New Year ${size === 1 ? "pigeon" : "pigeons"}`,
      prefill: { name: sender.name, email: sender.email },
      notes: { order_ref: orderForCheckout.orderRef },
      theme: { color: "#C42B2B" },
      timeout: orderForCheckout.checkoutTimeoutSeconds,
      modal: {
        confirm_close: true,
        ondismiss: () => {
          setBusy("idle");
          setNotice({ tone: "info", text: "Payment not completed. Your letters are saved here; tap pay to try again." });
        },
      },
      handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        setBusy("verifying");
        try {
          await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderRef: orderForCheckout.orderRef, accessToken: orderForCheckout.accessToken, ...response }),
          });
        } catch {
          // The order page will keep checking; the webhook confirms too.
        }
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {}
        router.push(`/order/${orderForCheckout.orderRef}?k=${encodeURIComponent(orderForCheckout.accessToken)}`);
      },
    });
    checkout.on("payment.failed", (r: { error?: { description?: string } }) => {
      setNotice({
        tone: "error",
        text: `Payment failed: ${r?.error?.description ?? "please try another method"}. You haven't been charged for this attempt.`,
      });
    });
    checkout.open();
  }

  const steps: { id: Step; label: string }[] = [
    { id: "package", label: "Bundle" },
    { id: "letters", label: "Letters" },
    { id: "review", label: "Review and pay" },
  ];
  const stepIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="flow" ref={topRef}>
      <ol className="flow__progress" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.id} aria-current={s.id === step ? "step" : undefined} className={i < stepIndex ? "is-done" : undefined}>
            {s.label}
          </li>
        ))}
      </ol>

      {lastOrder && step === "package" && (
        <p className="notice">
          You started a payment earlier.{" "}
          <Link href={`/order/${lastOrder.orderRef}?k=${encodeURIComponent(lastOrder.accessToken)}`}>Check that order&rsquo;s status</Link>{" "}
          before paying again.
        </p>
      )}

      {notice && <p className={`notice${notice.tone === "error" ? " notice--error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}

      {step === "package" && (
        <section aria-labelledby="pick">
          <h1 id="pick">How many pigeons?</h1>
          <p className="lede">Each pigeon carries one letter to one person. You&rsquo;ll write them all next and pay once.</p>
          {salesState !== "OPEN" && (
            <p className="notice">
              {salesState === "BEFORE"
                ? "Sales open on 1 December 2026 at 12:00 AM IST. You can look around until then."
                : "Sales have closed. Thank you to everyone who sent a pigeon."}
            </p>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ position: "absolute", left: "-9999px" }}>
              Bundle size
            </legend>
            <ul className="package-options">
              {packages.map((pkg) => (
                <li key={pkg.size}>
                  <label>
                    <input
                      type="radio"
                      name="package"
                      value={pkg.size}
                      checked={size === pkg.size}
                      onChange={() => choosePackage(pkg.size)}
                    />
                    <PriceStamp pkg={pkg} selected={size === pkg.size} />
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {priceNote}
          <div className="flow__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={!size || !canBuy}
              onClick={() => {
                setNotice(null);
                setStep("letters");
              }}
            >
              {size ? `Write ${size === 1 ? "my letter" : `${size} letters`}` : "Choose a bundle"}
            </button>
          </div>
        </section>
      )}

      {step === "letters" && size && (
        <section aria-labelledby="letters">
          <h1 id="letters">Write your letters</h1>
          <p className="lede">
            All pigeons land on {deliveryDateLabel}, Indian Standard Time. Pick a half-hour for each one.
          </p>

          <div className="card">
            <h2 style={{ fontSize: "1.2rem" }}>From you</h2>
            <TextField
              id="sender-name"
              label="Your name, as the recipients know you"
              value={sender.name}
              error={errors["sender.name"]}
              autoComplete="name"
              onChange={(v) => {
                setSender((s) => ({ ...s, name: v }));
                setErrors(({ ["sender.name"]: _, ...rest }) => rest);
              }}
            />
            <TextField
              id="sender-email"
              label="Your email"
              type="email"
              hint="Your receipt and private order link go here. Recipients never see it."
              value={sender.email}
              error={errors["sender.email"]}
              autoComplete="email"
              onChange={(v) => {
                setSender((s) => ({ ...s, email: v }));
                setErrors(({ ["sender.email"]: _, ...rest }) => rest);
              }}
            />
          </div>

          {pigeons.map((p, i) => {
            const open = openIndex === i;
            const hasError = Object.keys(errors).some((k) => k.startsWith(`pigeons.${i}.`));
            const complete = pigeonInputSchema.safeParse(p).success;
            const count = countGraphemes(p.message);
            return (
              <div className="card pigeon-card" key={i}>
                <button
                  type="button"
                  className="pigeon-card__head"
                  aria-expanded={open}
                  aria-controls={`pigeon-${i}`}
                  onClick={() => setOpenIndex(open ? -1 : i)}
                >
                  <span>
                    Pigeon {i + 1} of {size}
                    {p.recipientName && <small> to {p.recipientName}</small>}
                  </span>
                  <span
                    className={`pigeon-card__status pigeon-card__status--${hasError ? "error" : complete ? "ok" : "todo"}`}
                  >
                    {hasError ? "Needs a fix" : complete ? `${slotLabel(p.slot)}` : "To write"}
                  </span>
                </button>
                {open && (
                  <div className="pigeon-card__body" id={`pigeon-${i}`}>
                    <TextField
                      id={`r-name-${i}`}
                      label="Their name"
                      hint="First name or what you call them. Shown on the letter."
                      value={p.recipientName}
                      error={errors[`pigeons.${i}.recipientName`]}
                      onChange={(v) => updatePigeon(i, { recipientName: v })}
                    />
                    <TextField
                      id={`r-email-${i}`}
                      label="Their email"
                      type="email"
                      value={p.recipientEmail}
                      error={errors[`pigeons.${i}.recipientEmail`]}
                      onChange={(v) => updatePigeon(i, { recipientEmail: v })}
                    />
                    <div className="field">
                      <label htmlFor={`msg-${i}`}>Your letter</label>
                      <textarea
                        id={`msg-${i}`}
                        value={p.message}
                        aria-invalid={Boolean(errors[`pigeons.${i}.message`]) || count > MESSAGE_MAX}
                        aria-describedby={`msg-${i}-count`}
                        onChange={(e) => updatePigeon(i, { message: e.target.value })}
                      />
                      <span
                        id={`msg-${i}-count`}
                        className={`field__counter${count > MESSAGE_MAX ? " field__counter--over" : ""}`}
                        aria-live="polite"
                      >
                        {count} / {MESSAGE_MAX}
                      </span>
                      {errors[`pigeons.${i}.message`] && <span className="field__error">{errors[`pigeons.${i}.message`]}</span>}
                    </div>
                    <div className="field">
                      <label htmlFor={`slot-${i}`}>Lands on {deliveryDateLabel} at (IST)</label>
                      <select id={`slot-${i}`} value={p.slot} onChange={(e) => updatePigeon(i, { slot: e.target.value })}>
                        {SLOTS.map((s) => (
                          <option key={s} value={s}>
                            {slotLabel(s)}
                          </option>
                        ))}
                      </select>
                      {size > 1 && (
                        <button type="button" className="link-button" style={{ justifySelf: "start", fontSize: "0.98rem" }} onClick={() => applySlotToAll(p.slot)}>
                          Apply this delivery time to all pigeons
                        </button>
                      )}
                    </div>
                    {i < size - 1 && (
                      <p>
                        <button type="button" className="button button--quiet" onClick={() => setOpenIndex(i + 1)}>
                          Next pigeon
                        </button>
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flow__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setNotice(null);
                if (validateLetters()) setStep("review");
              }}
            >
              Review {size === 1 ? "my letter" : "all letters"}
            </button>
            <button type="button" className="button button--quiet" onClick={() => setStep("package")}>
              Change bundle
            </button>
          </div>
        </section>
      )}

      {step === "review" && size && selected && (
        <section aria-labelledby="review">
          <h1 id="review">Check your letters</h1>
          <p className="lede">
            From {sender.name} ({sender.email}). Letters can&rsquo;t be read by anyone until they land.
          </p>
          <ul className="review-list">
            {pigeons.map((p, i) => (
              <li className="review-item" key={i}>
                <div className="review-item__meta">
                  <strong>
                    {i + 1}. {p.recipientName}
                  </strong>
                  <span>{slotLabel(p.slot)} IST</span>
                </div>
                <div className="review-item__meta">
                  <span>{p.recipientEmail}</span>
                </div>
                <p className="review-item__message">{p.message}</p>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setOpenIndex(i);
                    setStep("letters");
                  }}
                >
                  Edit this letter
                </button>
              </li>
            ))}
          </ul>

          <label className="check">
            <input type="checkbox" checked={allowPublic} onChange={(e) => setAllowPublic(e.target.checked)} />
            <span>
              Let my recipients release these letters into the public Pigeon Universe if they want to. Only the letter text is
              shown, with first names only if the recipient chooses. Every released letter is reviewed first. Email addresses are
              never shown.
            </span>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={accept}
              onChange={(e) => {
                setAccept(e.target.checked);
                setErrors(({ acceptTerms: _, ...rest }) => rest);
              }}
            />
            <span>
              I agree to the <Link href="/terms" target="_blank">terms</Link>, the <Link href="/privacy" target="_blank">privacy policy</Link> and the{" "}
              <Link href="/refunds" target="_blank">cancellation and refund policy</Link>, and I have permission to send these letters to these email addresses.
            </span>
          </label>
          {errors.acceptTerms && <p className="field__error">{errors.acceptTerms}</p>}

          <div className="flow__total">
            <span>
              {size} {size === 1 ? "pigeon" : "pigeons"}
              <br />
              <small style={{ color: "var(--muted)" }}>Includes applicable taxes</small>
            </span>
            <strong>{formatRupees(order && order.inputKey === inputKey ? order.amountPaise : selected.amountPaise)}</strong>
          </div>

          <div className="flow__actions">
            <button type="button" className="button button--primary" onClick={pay} disabled={busy !== "idle" || !canBuy}>
              {busy === "creating" && "Preparing your order…"}
              {busy === "checkout" && "Waiting for payment…"}
              {busy === "verifying" && "Confirming payment…"}
              {busy === "idle" &&
                `Pay ${formatRupees(order && order.inputKey === inputKey ? order.amountPaise : selected.amountPaise)}`}
            </button>
            <button type="button" className="button button--quiet" onClick={() => setStep("letters")}>
              Back to letters
            </button>
          </div>
          <p className="field__hint" style={{ marginTop: "1rem" }}>
            Payments are handled securely by Razorpay. Your price is held for {checkoutMinutes} minutes once you start paying.
          </p>
        </section>
      )}
    </div>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: "text" | "email";
  autoComplete?: string;
}) {
  const describedBy = [props.hint ? `${props.id}-hint` : null, props.error ? `${props.id}-err` : null].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.hint && (
        <span className="field__hint" id={`${props.id}-hint`}>
          {props.hint}
        </span>
      )}
      <input
        id={props.id}
        type={props.type ?? "text"}
        inputMode={props.type === "email" ? "email" : undefined}
        autoComplete={props.autoComplete ?? "off"}
        value={props.value}
        aria-invalid={Boolean(props.error)}
        aria-describedby={describedBy || undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.error && (
        <span className="field__error" id={`${props.id}-err`}>
          {props.error}
        </span>
      )}
    </div>
  );
}
