# CLAUDE.md: rules for working on Pigeon Post 2027

Paid, India-only New Year gifting site. Real money, real personal data, and a delivery day (1 Jan 2027 IST) that cannot be repeated. Payment integrity, privacy and delivery reliability come before polish. The owner wants decisions explained: for any non-trivial change, say what it does, why, what you rejected and what can fail.

Read `README.md` (architecture and setup) and `docs/DECISIONS.md` (reasoning and assumptions) before changing payment, delivery or token code.

## Commands

```bash
npm run dev          # local app
npm run typecheck    # tsc, must pass
npm test             # unit tests, must pass
DATABASE_URL=postgres://...superuser@disposable-db/postgres npm run test:db   # SQL integration tests
npm run build        # must pass before pushing
cd supabase/functions/deliver && deno check index.ts   # type-check the Edge Function
```

## Non-negotiable rules

**Money**
- Amounts are integer paise, computed on the server from `src/lib/pricing.ts`, the only price table. The browser never sends an amount; if it does, it is ignored.
- Every order stores a full price snapshot. Don't recalculate the price of an existing order.
- Pigeons become active only through `confirm_order_payment()` (SQL), and only after the server has fetched the payment from Razorpay and seen `status = captured`. A DB trigger blocks any other activation path. Never weaken it.
- Webhooks: verify the HMAC over the **raw** body before parsing; dedupe on `(source, event_id)`; `PAID` never moves backwards (trigger enforced).
- Never store card or UPI details. Never trust the Checkout success callback on its own.

**Time**
- "Now" comes from `now()` in `src/lib/campaign.ts` (server clock) or `now()` in SQL. Never the browser.
- Store `timestamptz` (UTC). Business logic is in IST. Slots are `'00:00'..'23:30'` IST on the delivery date; a CHECK constraint ties `slot_local` to `scheduled_at_utc`.

**Delivery**
- Only the `deliver` Edge Function, triggered by Supabase Cron, sends recipient email. No browser timers.
- Pattern: claim (short transaction, `FOR UPDATE SKIP LOCKED`, lease) → send outside any transaction with idempotency key `pigeon/{id}/v{send_generation}` → record in its own short transaction. Don't hold a transaction across an HTTP call.
- Honest statuses: provider accepted = `EMAIL_ACCEPTED`. Only a signed provider event sets `DELIVERED_BY_PROVIDER`.

**Privacy and security**
- Link tokens: `deriveToken(TOKEN_SECRET, purpose, id, nonce)` in `supabase/functions/_shared/tokens.ts`. The DB stores only the nonce and SHA-256 hash. Order links use the order's `public_ref` as id; recipient links use the pigeon's UUID. Changing either breaks every link already emailed.
- The service-role client (`src/lib/db.ts`) is server only (`import "server-only"`). Never import it, or anything that imports it, in a `"use client"` file.
- All tables have RLS on with no policies, and anon/authenticated privileges are revoked. **Every new migration that adds tables or functions must end with the same REVOKE/GRANT block** as the initial migration. `tests/db.test.ts` checks this for existing objects; extend it.
- Nothing is public unless the sender allowed it, the recipient released it, and an admin approved it. Never expose email addresses publicly. Messages never appear in emails or on `/p/` pages.
- `/admin` is Basic auth (`src/proxy.ts`), and admin server actions re-check credentials.

**Honesty**
- No fake countdowns, scarcity, testimonials or seeded Universe content. Example content must be labelled as an example.
- Never invent GST rates, registration status, legal entity details or refund terms. They live in `src/content/business.ts` and render as visible placeholders until the owner fills them.

## Conventions

- Next.js 16 App Router. `src/proxy.ts` replaces middleware. Route params are Promises.
- Pages that depend on the clock or the DB: `export const dynamic = "force-dynamic"`.
- Code shared by Node and Deno lives in `supabase/functions/_shared/`. It must use only Web APIs and have no npm imports. Imports between shared files use explicit `.ts` extensions. Next imports it via `@shared/*`.
- The Edge Function imports `npm:@supabase/supabase-js@2`.
- Styling: plain CSS in `src/app/globals.css` with the tokens at the top ("Dak Mela", a festival of postage: rani pink, marigold, peacock blue, sky, tota green, orange, ink on white paper). White text only on pink or peacock; everything else uses ink. Paper surfaces use the ink outline and solid offset shadow (`--line`, `--lift`). Fonts: Baloo 2 (display, includes Devanagari), Mukta (UI, includes Devanagari), Kalam (letters, includes Devanagari).
- Festive motion lives in `Fireworks`, `Confetti` and `Countdown`, plus the hero's stamp-and-pigeon landing in CSS; `Decorations` (bunting) is static. All of them must keep respecting `prefers-reduced-motion`, and the countdown must keep starting from server time.
- UI copy: sentence case, plain verbs, no "→" or middle-dot separators. The brief's CTAs are exact: "Send Your First Pigeon", "Explore the Pigeon Universe", "Apply this delivery time to all pigeons".

## When you change…

- **Prices:** edit `PRICE_TIERS` only; update `tests/pricing.test.ts`.
- **Statuses:** update the CHECK constraint (new migration), `src/lib/status.ts`, and the SQL functions that move between states.
- **The email provider:** rewrite `_shared/resend.ts` while keeping the `SendResult` contract, plus `src/app/api/webhooks/email/route.ts` and `src/lib/svix.ts`.
- **Anything in payment or delivery:** list the failure cases it handles (README failure matrix in `docs/DECISIONS.md`) and add a DB test.
