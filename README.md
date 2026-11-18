# Pigeon Post 2027

*A little bird. A special message.*

Customers buy a bundle of virtual pigeons (1, 3, 5, 10 or 20), write one letter per recipient, and pay once with Razorpay. On **1 January 2027 (IST)**, at the half-hour slot chosen for each pigeon, the recipient gets an email with a private link. Opening it plays the reveal: a pigeon flies in, lands, drops an envelope, and the recipient taps it open. They can then release the letter into the public **Pigeon Universe**, where it shows up after an admin approves it.

India only (INR, IST, Razorpay). Sales run 1–31 December 2026. No accounts.

- **Why it's built this way:** [`docs/DECISIONS.md`](docs/DECISIONS.md) covers each decision, the alternatives rejected, the failure cases handled, and every assumption.
- **What to do before launch and on the day:** [`docs/LAUNCH-CHECKLIST.md`](docs/LAUNCH-CHECKLIST.md).
- **Rules for Claude Code sessions:** [`CLAUDE.md`](CLAUDE.md).

---

## Architecture

```
 Browser (mobile first)                Vercel: Next.js 16                    Supabase
 ─────────────────────                 ──────────────────                    ────────
 /send  ── POST /api/orders ─────────► validate, price from server clock ──► create_order_with_pigeons()
                                       snapshot, create Razorpay order        (order + N pigeons, atomic)
 Razorpay Checkout ◄── order_id ──────┘
   │ success handler
   └──── POST /api/payments/verify ──► verify signature, FETCH payment ──┐
 Razorpay ── webhook ─────────────────► verify raw-body HMAC, dedupe ─────┼─► confirm_order_payment()
 Supabase Cron (5 min) ──► /api/cron/reconcile ► fetch order payments ──┘   (PAID once, activate
                                                                              pigeons, queue receipt)

 Supabase Cron (every minute) ──► Edge Function `deliver`
        claim_due_pigeons()  (FOR UPDATE SKIP LOCKED, lease, short txn)
        → send via Resend with Idempotency-Key   (no DB transaction open)
        → record_pigeon_attempt()  (EMAIL_ACCEPTED | retry w/ backoff | FAILED + alert)
        → order confirmations (email_outbox), alert digest, heartbeat
 Resend ── webhook ──► /api/webhooks/email ──► apply_email_event()  (DELIVERED_BY_PROVIDER, bounces)

 Recipient email link ──► /open/{token} ── reveal ── release ──► universe_releases (PENDING)
 Owner ──► /admin (Basic auth) ── approve ──► /universe shows APPROVED letters only
```

### Repository map

| Path | What it is |
|---|---|
| `src/lib/pricing.ts` | **The** central price table (integer paise) and tier logic. Server only. |
| `src/lib/campaign.ts` | Sales window, delivery date, the trusted clock (`now()`), IST formatting. |
| `src/lib/validation.ts` | Zod schemas shared by browser and server; grapheme-based 500-character limit. |
| `src/lib/payments.ts` | The one path from "captured payment" to "active pigeons", plus reconciliation. |
| `src/lib/razorpay.ts` | Orders API, payment fetch, checkout and webhook signature checks. |
| `src/app/api/*` | Orders, payment verify, Razorpay and Resend webhooks, reconcile cron, recipient actions, Universe. |
| `src/app/*` | Pages: landing, `/send`, `/order/[ref]`, `/p/[id]`, `/open/[token]`, `/universe`, policy pages, `/admin`. |
| `src/components/` | Pigeon SVG, reveal animation, send flow, price stamps. |
| `src/content/business.ts` | **Owner to fill in:** legal name, address, GST status, refund policy, and so on. |
| `supabase/migrations/` | Schema, guard triggers and every state-changing SQL function. |
| `supabase/functions/deliver/` | The scheduler Edge Function (Deno). |
| `supabase/functions/_shared/` | Code shared by Next.js and Deno: link tokens, slots, money, email templates, Resend client. |
| `supabase/setup/cron.sql` | One-time Cron + Vault setup (run by hand). |
| `tests/` | Unit tests, plus `db.test.ts` integration tests against real Postgres. |

---

## Run it locally

```bash
npm install
cp .env.example .env.local      # fill in values; APP_ENV=development
npm run dev                     # http://localhost:3000
```

Pages that read the database need a Supabase project (or `supabase start` with the Supabase CLI and `supabase db reset`). The landing, pricing and `/send` pages work without one.

To test pricing before December, set `CLOCK_OVERRIDE_IST=2026-12-08T09:00` in `.env.local`. It is ignored when `APP_ENV=production` or unset.

### Tests

```bash
npm run typecheck
npm test                                    # unit tests (DB tests skip without DATABASE_URL)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

`test:db` needs a **disposable** Postgres where the URL is a superuser. It creates a temporary database, mimics Supabase's roles and default grants, applies the migration, and checks every SQL function: activation exactly once, duplicate and mismatched payments, forward-only states, concurrent claiming without overlap, backoff and dead-lettering, lease recovery, provider events, and that `anon` can't read anything.

---

## Set up for real

Do these in order. Use **test mode** everywhere first. Details and timing are in [`docs/LAUNCH-CHECKLIST.md`](docs/LAUNCH-CHECKLIST.md).

### 1. Supabase
1. Create a project in the **Mumbai (ap-south-1)** region.
2. Apply the migration: `supabase link --project-ref <ref>` then `supabase db push`, or paste `supabase/migrations/20261118000000_init.sql` into the SQL editor.
3. Deploy the scheduler: `supabase functions deploy deliver`. `supabase/config.toml` turns off JWT verification for it, because it checks its own `x-cron-secret` instead.
4. Set the function's secrets with `supabase secrets set KEY=value`:
   `CRON_SECRET`, `TOKEN_SECRET` (identical to Vercel's), `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Pigeon Post 2027 <pigeons@mail.yourdomain>`), `EMAIL_REPLY_TO`, `APP_BASE_URL`, `ADMIN_ALERT_EMAIL`, and optionally `EMAIL_MAX_SENDS_PER_SECOND` (default 4).
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are normally provided automatically. If your project uses the new API keys and the function can't connect, set `SUPABASE_SERVICE_ROLE_KEY` to a secret key yourself.
5. After step 3 of the Vercel section, run `supabase/setup/cron.sql` in the SQL editor with your real values.

### 2. Razorpay
1. Use the **test** keys (`rzp_test_…`) in Vercel until live activation is approved.
2. Dashboard → Webhooks: URL `https://<domain>/api/webhooks/razorpay`, events `payment.captured`, `order.paid`, `payment.failed`, and a secret (that secret becomes `RAZORPAY_WEBHOOK_SECRET`).
3. Check that **automatic capture** is on (Settings → Payment capture). Pigeons activate only on *captured* payments.
4. Live activation needs the policy pages to be complete. Fill in `src/content/business.ts` first.

### 3. Resend (email)
1. Add and verify a sending subdomain, such as `mail.<domain>`, with SPF and DKIM. Add a DMARC record.
2. Create an API key, which becomes `RESEND_API_KEY` in the Supabase secrets.
3. Webhooks: URL `https://<domain>/api/webhooks/email`, events `email.delivered`, `email.bounced`, `email.delivery_delayed`, `email.complained` and `email.failed`. The signing secret becomes `RESEND_WEBHOOK_SECRET` in Vercel.
4. Ask Resend for a rate-limit increase before December, then raise `EMAIL_MAX_SENDS_PER_SECOND` to match. Size it from the admin page's slot-load chart.

### 4. Vercel
1. Import the repo, framework Next.js.
2. Add every variable from `.env.example`, with `APP_ENV=production`.
3. Deploy, then point the domain at it.

---

## Owner decisions still open

These are placeholders in the code, not guesses. See `docs/DECISIONS.md` § Assumptions and the project's open-questions doc.

- Legal name, address, grievance officer, GST status, jurisdiction → `src/content/business.ts` (Q14)
- Refund and cancellation policy → `business.refundPolicy` (Q8)
- Data-retention period → `business.dataRetentionDays` (Q15)
- Domain (assumed `happynewyear2027.in`, not confirmed) → `APP_BASE_URL` (Q2)
- Whether senders can edit letters after paying. Not built (Q8).
