# Decisions, reasoning and assumptions

For each part of the system: what was chosen, why, what was rejected, and what can go wrong. Items marked **Assumption** are defaults Claude chose where the brief or owner hasn't decided. They're collected at the end with the open question each one maps to.

---

## 1. Stack

**Chosen:** Next.js 16 (App Router) on Vercel, Supabase (Postgres, Cron, Edge Functions), Razorpay Orders API, Resend for email.

**Why.** The brief names Razorpay and Supabase Cron + Edge Functions. Next.js on Vercel matches the owner's existing hosting (happynewyear2027.in is on Vercel). One codebase covers the pages and the API routes, and server components let price and status pages render from the server clock with no client-side trust.

**Resend (Assumption, Q3)** meets the five requirements in the open-questions doc:
- an `Idempotency-Key` header (24-hour window)
- signed delivery, bounce, delay and complaint webhooks (Svix)
- custom-domain SPF/DKIM
- a per-team rate limit that can be raised on request
- a simple REST API

It's isolated in `supabase/functions/_shared/resend.ts` behind a four-outcome contract (`ACCEPTED`, `THROTTLED`, `RETRY`, `PERMANENT_FAILURE`), so switching providers touches two files. Resend's documented default rate limit has varied between 2 and 10 requests per second across its docs pages, so the scheduler defaults to a conservative 4 per second (`EMAIL_MAX_SENDS_PER_SECOND`). Check the dashboard and raise it.

**Rejected:**
- A separate backend service: more to deploy and monitor for no gain.
- Vercel Cron for delivery: the brief prefers Supabase Cron, and Vercel's Hobby plan only runs cron jobs daily.
- The Razorpay Node SDK: four endpoints are clearer as plain `fetch`, and every request and check is visible.

## 2. Pricing

- One table, `PRICE_TIERS` in `src/lib/pricing.ts`, in integer paise. Tier boundaries are IST wall times converted to UTC instants, so 8 Dec 00:00 IST is 7 Dec 18:30 UTC (tested to the second).
- The browser receives prices for display only. `POST /api/orders` takes package size and text, not money. An `amountPaise` field sent by the browser is stripped by the schema (tested).
- **Snapshot:** the order row stores `{tierId, tierLabel, amountPaise, approxPerPigeonPaise, quotedAt, snapshot_at, expires_at}`. The Razorpay order is created for exactly that amount. If a tier boundary passes mid-checkout, the open order keeps its price. If the customer comes back after expiry (default 15 minutes, `CHECKOUT_TTL_MINUTES`), a new order is created at the current tier, and the UI says so before charging ("Prices changed at midnight…").
- The "next price increase" line comes from the same table. The last window shows the sales-close time instead. No countdown timers.
- **Rejected:** prices in the database. That would allow edits without a deploy (R10), but it adds an admin UI and a new way to get prices wrong. A Vercel deploy takes about a minute.

## 3. Payments

Three independent paths can confirm a payment. All of them call `confirmCapturedPayment()` → `confirm_order_payment()` (SQL), which is idempotent:

1. **Checkout callback** (`/api/payments/verify`): verifies `HMAC(order_id|payment_id, key_secret)`, then **fetches the payment from Razorpay** and requires `captured`, the same Razorpay order, and the snapshot amount. The callback only triggers this check; the browser is never trusted on its own.
2. **Webhook** (`/api/webhooks/razorpay`): HMAC over the **raw bytes** of the request, before any JSON parsing. Events are stored with `unique(source, event_id)` on `x-razorpay-event-id`. A repeat of a processed event returns 200 and is skipped. Processing errors return 500 so Razorpay retries (for up to 24 hours).
3. **Reconciliation** (`/api/cron/reconcile`, every 5 minutes): for pending orders and orders that expired in the last 24 hours, it fetches `GET /orders/:id/payments` and confirms any captured payment. Pending orders past expiry plus a 15-minute grace period become `EXPIRED`.

`confirm_order_payment()` runs in one transaction with the order row locked:
- records the payment (status only moves forward to `captured`)
- marks the order `PAID` once
- activates exactly `package_size` pigeons with their token hashes
- queues the sender's confirmation email

A trigger makes `PAID` forward-only. A second trigger rejects any pigeon leaving `PENDING_PAYMENT` while its order isn't `PAID`, so even a bug elsewhere can't activate unpaid pigeons.

### Failure matrix

| Scenario | What happens | Where |
|---|---|---|
| Successful payment | Callback and webhook both arrive; the first returns `ACTIVATED`, the second `ALREADY_PAID` | `confirm_order_payment` |
| Failed payment | `payment.failed` recorded; order stays payable until expiry; pigeons inactive | `record_payment_failure` |
| Abandoned checkout | Becomes `EXPIRED` after the window plus 15 minutes; Checkout's own `timeout` closes the modal at expiry | reconcile |
| Duplicate webhook | Unique event id → acknowledged with 200 and skipped | `webhook_events` |
| Delayed webhook | The callback fetches the payment itself; reconciliation catches anything left | verify, reconcile |
| Out-of-order webhook | `payment.failed` after `captured` doesn't downgrade; `PAID` is forward-only | SQL guard and trigger |
| Duplicate payment | Second captured payment recorded, flagged `DUPLICATE_PAYMENT`, admin alerted; refund it in the Razorpay dashboard | `confirm_order_payment` |
| Site down when paid | Razorpay retries webhooks for 24 hours; reconciliation fetches payments | reconcile |
| Captured after our expiry | **Honoured** at the snapshot price (Assumption, Q5) | `EXPIRED → PAID` allowed |
| Captured after sales close | Honoured; orders can only be created before close (Assumption, Q6) | same |
| Amount or currency mismatch | Not activated; flagged `AMOUNT_MISMATCH`; admin alerted | `confirm_order_payment` |
| Payment authorized, not captured | Not activated. Auto-capture must be on in the dashboard; reconciliation picks up the capture | verify returns `PENDING` |

All of these are covered by `tests/db.test.ts`, and the webhook paths were also run against the real routes.

## 4. Scheduled delivery

`deliver` (Edge Function) runs every minute from Supabase Cron via `pg_net` with an `x-cron-secret` header.

1. **Claim:** `claim_due_pigeons(limit, lease)` selects due rows (`order PAID`, `scheduled_at_utc <= now()`, `SCHEDULED` with `next_attempt_at <= now()`, or `PROCESSING` with an expired lease) using `FOR UPDATE SKIP LOCKED`. It sets them to `PROCESSING` with a new `claim_id` and a 180-second lease, and commits. Overlapping runs never get the same row (tested with four concurrent claimers).
2. **Send:** outside any transaction, rate-limited, with idempotency key `pigeon/{id}/v{send_generation}`. The email contains only the private link, never the message.
3. **Record:** `record_pigeon_attempt()` in its own short transaction. A result whose `claim_id` no longer matches (the lease expired and another run took over) is ignored as stale.
   - Accepted → `EMAIL_ACCEPTED` plus the provider message id.
   - Retryable error → `SCHEDULED` with backoff of 30s, 1m, 2m, 4m, 8m, 16m, then 30m.
   - 8 attempts used, or a permanent error → `FAILED`, an admin alert, and an event row.
   - A 429 from the provider is **not** counted as an attempt.

**Crash between send and record:** the lease expires, the pigeon is reclaimed, and the same idempotency key makes Resend return the original email instead of sending another. This was tested end to end against a mock provider: one email, not two.

**Throughput:** each run claims no more than it can send before its 50-second budget ends. At the default 4 per second that's about 200 pigeons a minute, or about 2,000 in the first 10 minutes. The admin page shows how many pigeons are booked into each slot. If the 12:00 AM bar gets large, ask Resend for a higher limit and raise `EMAIL_MAX_SENDS_PER_SECOND`. **Rejected:** Resend's batch API. It sends 100 emails per request, but takes one idempotency key per batch, which breaks the per-pigeon guarantee.

**Honest statuses:** `EMAIL_ACCEPTED` means the provider took it. `DELIVERED_BY_PROVIDER` is set only by a signed `email.delivered` webhook. A later bounce moves the pigeon to `FAILED` (bounce wins). Senders see "Sent, waiting for delivery confirmation", "Delivered to their inbox provider" or "Could not be delivered".

**Monitoring:** every run writes `scheduler_runs`, and `/admin` turns red if the last run is more than 3 minutes old. New `admin_alerts` rows are emailed to `ADMIN_ALERT_EMAIL` as one digest per run. If sends fail across the board, a `SCHEDULER_UNHEALTHY` alert is raised, at most every 10 minutes.

## 5. Private links

Recipient link: `/open/{token}`. Sender link: `/order/{ref}?k={token}`.

```
token = base64url(HMAC-SHA256(TOKEN_SECRET, "<purpose>:<id>:<nonce>"))   // 256 bits
DB stores: nonce, sha256(token)
```

**Why derive instead of storing a random token?** The brief says to store the token securely. Storing only a hash means a database leak doesn't expose working links. But the scheduler has to put the link in an email on 1 January, possibly on a retry, and it must be the same link every time. Deriving the token from a server secret plus a stored nonce gives both properties. **Rejected:** encrypting the raw token in the database, which needs more key handling for the same result; and generating the token at send time, which breaks idempotent retries.

- `TOKEN_SECRET` must be identical in Vercel and the Edge Function and must never change after the first order.
- Pages carrying tokens send `Referrer-Policy: no-referrer`, `noindex` and `no-store`.
- Opening `/open/…` doesn't mark the pigeon as opened, because email security scanners follow links. Tapping the envelope does.

## 6. Privacy and lockdown

- All tables have RLS enabled with no policies. `anon` and `authenticated` lose every table, sequence and function privilege. Only the service role is used, from server code. The test suite applies Supabase's default "grant everything" privileges and then proves `anon` gets *permission denied*. This was also checked through a real PostgREST.
- Data collected: sender name and email; per pigeon, recipient name, email and message; payment metadata. No accounts, no analytics.
- Light abuse controls: at most 10 orders per sender email per hour; a sender declaration of permission at checkout; "reply to report" in every recipient email; admin cancel. **Assumption:** no automated content filtering in v1.

## 7. Pigeon Universe

A letter becomes public only if **all three** are true:
1. The sender allowed it at checkout (on by default, clearly explained, can be unticked).
2. The recipient chose to release it.
3. An admin approved it.

The message is copied into `universe_releases`, so private data can be deleted later without deleting public letters. First names appear only if the recipient opts in. Email addresses are never shown. Anyone can report a letter, which hides it again until it's re-reviewed. Before 1 January the Universe shows an honest empty state; nothing is seeded.

"Catch a pigeon" (Q13 default): tap a flying pigeon to get a random approved letter. No collection state.

## 8. Design direction

The palette comes from the subject: airmail aerogramme blue paper, midnight ink for the New Year sky, India Post pillar-box red, and marigold (the pigeon's eye and the stars). The airmail stripe is the one recurring motif. Prices are drawn as perforated postage stamps whose denomination is the price.

Type:
- **Young Serif** for headings: warm and slightly nostalgic.
- **Mukta** for the interface: highly legible, with Latin and Devanagari.
- **Kalam** for letters: handwritten, with Latin and Devanagari, so a Hindi letter looks hand-written too.

Motion is spent in one place, the reveal (fly in → land → drop → tap → open). The hero has one short fly-in. `prefers-reduced-motion` skips straight to the landed pigeon. The design is mobile-first and was checked at 390 px.

---

## Assumptions (defaults chosen; owner to confirm)

| # | Assumption | Open question |
|---|---|---|
| A1 | Next.js on Vercel; domain set by `APP_BASE_URL` (happynewyear2027.in assumed, not confirmed) | Q2 |
| A2 | Resend as the email provider, with a sending subdomain | Q3 |
| A3 | Admin alerts are emailed to one address, plus `/admin` | Q4 |
| A4 | A capture after checkout expiry is honoured at the snapshot price | Q5 |
| A5 | A capture after sales close is honoured if the order was created before close; overdue slots go out on the next run | Q6 |
| A6 | No restriction on picking 12:00 AM for late orders | Q7 |
| A7 | **No edits after payment** in v1; refund terms left as placeholders | Q8 |
| A8 | Bounces: the admin is alerted and can re-send to a corrected address from `/admin`. Senders aren't emailed automatically | Q9 |
| A9 | `/p/{id}` shows only "flying to {first name}, lands at {time}"; WhatsApp shares that page | Q10 |
| A10 | Sender access via the private link in the confirmation email and on the post-payment redirect | Q11 |
| A11 | Universe consent chain as in §7; sender opt-out at checkout | Q12 |
| A12 | "Catch" = tap for a random approved letter | Q13 |
| A13 | GST, legal entity and invoices not implemented; placeholders only. No invoice email beyond the receipt | Q14 |
| A14 | Data retention: no automatic deletion yet; a manual purge SQL is in the launch checklist | Q15 |
| A15 | Any Unicode allowed; 500 **graphemes**; line breaks kept; bidi and control characters stripped | Q16 |
| A16 | Max 10 orders per sender email per hour | R6 |
| A17 | 8 delivery attempts over about an hour before `FAILED` | brief truncated (Q1) |

## Not built in v1

- Editing letters or recipients after payment.
- Automatic refunds; issue them from the Razorpay dashboard.
- GST invoices.
- Automated data deletion.
- Automated content moderation.
- Telegram or SMS alerts.
- Anything from the part of the brief that was cut off after section 5 (Q1).
