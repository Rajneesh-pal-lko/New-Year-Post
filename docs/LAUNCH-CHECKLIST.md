# Launch checklist and delivery-day runbook

Dates are IST. Sales open **1 Dec 2026, 12:00 AM**. The first pigeons fly **1 Jan 2027, 12:00 AM** (31 Dec 18:30 UTC).

## This week (by 22 Nov): unblock Razorpay activation (R1, R2)

- [ ] Start Razorpay KYC and live activation now. It can take days.
- [ ] Decide the refund and cancellation policy (Q8) and the data-retention period (Q15).
- [ ] Fill in `src/content/business.ts`: legal name, address, support email, grievance officer, jurisdiction, GST status, refund policy, policies date. Every highlighted "[To be confirmed: …]" on the site must be gone.
- [ ] Have the terms and privacy pages reviewed by someone qualified. They're a plain-language starting point, not legal advice.
- [ ] Confirm the domain (Q2), deploy to Vercel, and give Razorpay the live site URL with the About, Contact, Pricing, Terms, Privacy and Refunds pages.

## By 27 Nov: everything working in test mode

- [ ] Supabase project in the Mumbai region: migration applied, `deliver` deployed with its secrets, `cron.sql` run.
- [ ] `/admin` shows a scheduler run less than a minute old.
- [ ] Resend: sending subdomain verified (SPF, DKIM), DMARC record added, webhook set, rate-limit increase requested.
- [ ] Razorpay **test** keys and webhook in place; auto-capture on.
- [ ] Full test purchase on a phone using staging overrides (`APP_ENV=staging`, `CLOCK_OVERRIDE_IST=2026-12-02T10:00`, `DELIVERY_DATE_OVERRIDE=<today>`, slot a few minutes ahead):
  - [ ] Pay with a test UPI ID, then a test card that fails, then one that succeeds.
  - [ ] Order page flips from "Confirming your payment" to "booked".
  - [ ] Confirmation email arrives, and its link opens the order page.
  - [ ] WhatsApp share opens with the pigeon page link.
  - [ ] At the slot, the recipient email arrives (check the spam folder in Gmail, Outlook and Yahoo), the reveal plays, and release works.
  - [ ] Approve the release in `/admin`; it appears in `/universe`.
  - [ ] Close Checkout without paying, wait about 30 minutes, and check that the order shows as expired.
- [ ] Switch to **live** keys and live webhook secret on 30 Nov. Make one real ₹49 purchase and refund it.

## 1 Dec: sales open

- [ ] `APP_ENV=production`, no override variables set in Vercel.
- [ ] Watch `/admin` for alerts. Order-confirmation emails also warm up the sending domain (R5).

## Mid-December: delivery rehearsal (R3, R4)

On a staging deployment with its own Supabase project:

- [ ] Use `DELIVERY_DATE_OVERRIDE` and create about 200 to 500 pigeons in a single slot, to test addresses you control and Resend's test addresses (`delivered@resend.dev`, `bounced@resend.dev`).
- [ ] Time how long the slot takes to drain. With the production slot counts from `/admin`, work out whether the 12:00 AM slot clears within a few minutes. If not, get a higher Resend limit and raise `EMAIL_MAX_SENDS_PER_SECOND`.
- [ ] Make sure bounces show as FAILED, an alert email arrives, and "Send again" with a corrected address works.
- [ ] Practise pausing delivery: `select cron.unschedule('pigeon-deliver');`, then reschedule it.

## 31 Dec: before midnight

- [ ] 18:00 IST: `/admin` heartbeat is green and there are no unresolved alerts.
- [ ] Check the slot-load chart. Confirm the Resend daily and monthly quota covers all paid pigeons plus about 10%.
- [ ] Check `ADMIN_ALERT_EMAIL` is reachable on your phone.
- [ ] 23:59:59: sales close automatically. Orders created before then and paid late are honoured, and their overdue slots go out on the next run.

## 1 Jan: delivery day (on call from 31 Dec 23:45 IST)

Every 15 minutes or so, look at `/admin`:

| You see | Do this |
|---|---|
| Heartbeat older than 3 minutes | In the Supabase SQL editor: `select * from cron.job_run_details order by start_time desc limit 10;` and `select status_code, left(content, 300) from net._http_response order by id desc limit 10;`. Use **Run delivery now** to drain by hand while you fix it. |
| "Due now, not yet sent" climbing | The provider is throttling. Check the Resend dashboard; use **Run delivery now**, which is safe to repeat because claims don't overlap. |
| `SCHEDULER_UNHEALTHY` alert | Every send is failing. It's usually an expired or wrong API key, or the domain lost verification. Fix it, then use **Run delivery now**. Pigeons retry by themselves for about an hour. |
| Pigeons in "Failed pigeons" | Bounce: contact the sender for the right address, then **Send again** with it. Provider error after 8 attempts: **Send again**. |
| Spam complaint alert | Look the pigeon up and decide whether to contact the sender. |

Nothing sends twice. Each pigeon's email carries an idempotency key, and re-sends from the admin page get a new one on purpose.

## After the campaign

- [ ] Refund anything the policy promises (failed pigeons, duplicate payments flagged in `/admin`).
- [ ] On the retention date you published, delete private data. Universe letters were copied and stay. Run this in the SQL editor after taking a backup:

```sql
-- Removes recipient emails, private messages and sender emails; keeps
-- payment records (amounts, ids) and approved Universe letters.
update public.pigeons
   set recipient_email = 'deleted', message = '', recipient_name = 'deleted'
 where created_at < now();
update public.orders
   set sender_email = 'deleted', sender_name = 'deleted'
 where created_at < now();
delete from public.delivery_events;
delete from public.webhook_events where source = 'resend';
update public.payments set raw = null;
update public.webhook_events set payload = '{}'::jsonb where source = 'razorpay';
```
