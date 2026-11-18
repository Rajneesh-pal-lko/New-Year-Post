-- Pigeon Post 2027: initial schema
--
-- Conventions
--   * Every timestamp is timestamptz (stored in UTC). IST is a display/business
--     concern handled in application code; the scheduled slot is also kept as
--     local text ('00:00'..'23:30') plus the timezone name.
--   * Money is integer paise. No floats anywhere.
--   * Status columns are text + CHECK so they read clearly in the Supabase UI.
--   * The browser never talks to these tables. RLS is on with no policies, and
--     anon/authenticated privileges are revoked at the bottom of this file. Only
--     the service role (server code, Edge Function) can read or write.
--   * Multi-step state changes live in plpgsql functions so they are atomic.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  public_ref            text not null unique,
  sender_name           text not null,
  sender_email          text not null,
  package_size          int  not null check (package_size in (1, 3, 5, 10, 20)),
  tier_id               text not null,
  amount_paise          int  not null check (amount_paise > 0),
  currency              text not null default 'INR' check (currency = 'INR'),
  price_snapshot        jsonb not null,
  allow_public_release  boolean not null default true,
  -- REFUNDED / PARTIALLY_REFUNDED are set manually by the admin until the
  -- refund policy (open question Q8) is decided.
  status                text not null default 'PENDING_PAYMENT'
                        check (status in ('PENDING_PAYMENT', 'PAID', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  expires_at            timestamptz not null,
  razorpay_order_id     text unique,
  paid_payment_id       text,
  paid_at               timestamptz,
  last_reconciled_at    timestamptz,
  -- Sender's private link: /order/{public_ref}?k={token}. Only the hash is
  -- stored; the token is re-derived from TOKEN_SECRET + nonce when emailing.
  access_token_nonce    text not null,
  access_token_hash     text not null unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index orders_status_created_idx on public.orders (status, created_at);
create index orders_sender_email_created_idx on public.orders (sender_email, created_at);

create table public.pigeons (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.orders (id) on delete cascade,
  position               int  not null check (position between 1 and 20),
  public_id              text not null unique,
  recipient_name         text not null,
  recipient_email        text not null,
  message                text not null,
  slot_local             text not null check (slot_local ~ '^([01][0-9]|2[0-3]):(00|30)$'),
  timezone               text not null default 'Asia/Kolkata' check (timezone = 'Asia/Kolkata'),
  scheduled_at_utc       timestamptz not null,
  status                 text not null default 'PENDING_PAYMENT'
                         check (status in ('PENDING_PAYMENT', 'SCHEDULED', 'PROCESSING', 'EMAIL_ACCEPTED',
                                           'DELIVERED_BY_PROVIDER', 'FAILED', 'CANCELLED')),
  -- Recipient link: /open/{token}. Generated when payment is confirmed.
  recipient_token_nonce  text,
  recipient_token_hash   text unique,
  -- Delivery bookkeeping
  attempts               int  not null default 0,
  send_generation        int  not null default 1,  -- bumped on manual re-send so the idempotency key changes
  next_attempt_at        timestamptz,
  locked_until           timestamptz,
  claim_id               uuid,
  provider_message_id    text unique,
  failure_reason         text,
  email_accepted_at      timestamptz,
  delivered_at           timestamptz,
  opened_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (order_id, position),
  -- The stored UTC instant must match the chosen IST slot.
  constraint pigeons_slot_matches_utc
    check (to_char(scheduled_at_utc at time zone 'Asia/Kolkata', 'HH24:MI') = slot_local)
);

create index pigeons_due_idx on public.pigeons (next_attempt_at) where status = 'SCHEDULED';
create index pigeons_stale_processing_idx on public.pigeons (locked_until) where status = 'PROCESSING';
create index pigeons_order_idx on public.pigeons (order_id);
create index pigeons_slot_idx on public.pigeons (slot_local, status);

create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  razorpay_payment_id  text not null unique,
  order_id             uuid references public.orders (id),
  razorpay_order_id    text,
  amount_paise         int  not null,
  currency             text not null,
  status               text not null,          -- Razorpay's status: authorized, captured, failed, refunded ...
  method               text,
  flag                 text check (flag in ('DUPLICATE_PAYMENT', 'AMOUNT_MISMATCH', 'ORDER_NOT_PAYABLE')),
  error_description    text,
  raw                  jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id);
create index payments_flag_idx on public.payments (flag) where flag is not null;

-- Every webhook we accept, deduplicated by the provider's event id.
create table public.webhook_events (
  id            bigserial primary key,
  source        text not null check (source in ('razorpay', 'resend')),
  event_id      text not null,
  event_type    text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  deliveries    int not null default 1,
  last_error    text,
  unique (source, event_id)
);

-- Attempt log for every pigeon: claims, sends, retries, provider events.
create table public.delivery_events (
  id          bigserial primary key,
  pigeon_id   uuid not null references public.pigeons (id) on delete cascade,
  attempt     int,
  event_type  text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index delivery_events_pigeon_idx on public.delivery_events (pigeon_id, created_at);

-- Non-pigeon transactional email (order confirmations), sent by the same
-- scheduler with the same claim/retry pattern.
create table public.email_outbox (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('ORDER_CONFIRMATION')),
  order_id             uuid not null references public.orders (id) on delete cascade,
  idempotency_key      text not null unique,
  status               text not null default 'PENDING'
                       check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'BOUNCED')),
  attempts             int not null default 0,
  next_attempt_at      timestamptz not null default now(),
  locked_until         timestamptz,
  claim_id             uuid,
  provider_message_id  text unique,
  last_error           text,
  sent_at              timestamptz,
  created_at           timestamptz not null default now()
);

create index email_outbox_due_idx on public.email_outbox (next_attempt_at) where status = 'PENDING';

-- Pigeons released by their recipient into the public Pigeon Universe.
-- The message is copied so public content survives deletion of private data.
create table public.universe_releases (
  id                 uuid primary key default gen_random_uuid(),
  pigeon_id          uuid not null unique references public.pigeons (id) on delete cascade,
  message            text not null,
  from_name          text,   -- set only if the recipient chose to show first names
  to_name            text,
  moderation_status  text not null default 'PENDING' check (moderation_status in ('PENDING', 'APPROVED', 'REJECTED')),
  report_count       int not null default 0,
  released_at        timestamptz not null default now(),
  moderated_at       timestamptz
);

create index universe_releases_status_idx on public.universe_releases (moderation_status);

create table public.admin_alerts (
  id          bigserial primary key,
  kind        text not null,
  message     text not null,
  detail      jsonb,
  created_at  timestamptz not null default now(),
  emailed_at  timestamptz,
  resolved_at timestamptz
);

create index admin_alerts_unemailed_idx on public.admin_alerts (id) where emailed_at is null;

-- One row per scheduler invocation, so the admin page can show a heartbeat.
create table public.scheduler_runs (
  id           bigserial primary key,
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  summary      jsonb not null
);

create index scheduler_runs_started_idx on public.scheduler_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Guard triggers: invariants that must hold no matter which code path writes
-- ---------------------------------------------------------------------------

-- An order never moves backwards out of PAID (except to a refund state).
create or replace function public.guard_order_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'PAID' and new.status not in ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED') then
    raise exception 'ORDER_FORWARD_ONLY: order % cannot move from PAID to %', old.id, new.status;
  end if;
  return new;
end;
$$;

create trigger orders_forward_only
  before update of status on public.orders
  for each row execute function public.guard_order_status();

-- A pigeon can only leave PENDING_PAYMENT for an active state if its order is PAID.
create or replace function public.guard_pigeon_activation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'PENDING_PAYMENT' and new.status not in ('PENDING_PAYMENT', 'CANCELLED') then
    if not exists (select 1 from orders o where o.id = new.order_id and o.status = 'PAID') then
      raise exception 'UNPAID_ACTIVATION: pigeon % cannot be activated, order is not PAID', new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger pigeons_require_paid_order
  before update of status on public.pigeons
  for each row execute function public.guard_pigeon_activation();

-- ---------------------------------------------------------------------------
-- Checkout
-- ---------------------------------------------------------------------------

-- Creates an order and exactly package_size pigeons in one transaction.
-- Amount, tier and snapshot are computed by the server and passed in.
create or replace function public.create_order_with_pigeons(
  p_order              jsonb,
  p_pigeons            jsonb,
  p_checkout_minutes   int,
  p_max_recent_orders  int default 10
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order_id uuid;
  v_expires  timestamptz;
  v_count    int;
  v_recent   int;
begin
  -- Light abuse guard: cap new orders per sender email per hour.
  select count(*) into v_recent
    from orders
   where sender_email = p_order ->> 'sender_email'
     and created_at > now() - interval '1 hour';
  if v_recent >= p_max_recent_orders then
    raise exception 'RATE_LIMITED';
  end if;

  v_expires := now() + make_interval(mins => p_checkout_minutes);

  insert into orders (public_ref, sender_name, sender_email, package_size, tier_id, amount_paise, currency,
                      price_snapshot, allow_public_release, expires_at, access_token_nonce, access_token_hash)
  values (p_order ->> 'public_ref',
          p_order ->> 'sender_name',
          p_order ->> 'sender_email',
          (p_order ->> 'package_size')::int,
          p_order ->> 'tier_id',
          (p_order ->> 'amount_paise')::int,
          'INR',
          (p_order -> 'price_snapshot') || jsonb_build_object('snapshot_at', now(), 'expires_at', v_expires),
          coalesce((p_order ->> 'allow_public_release')::boolean, true),
          v_expires,
          p_order ->> 'access_token_nonce',
          p_order ->> 'access_token_hash')
  returning id into v_order_id;

  insert into pigeons (order_id, position, public_id, recipient_name, recipient_email, message, slot_local, scheduled_at_utc)
  select v_order_id, x.position, x.public_id, x.recipient_name, x.recipient_email, x.message, x.slot_local, x.scheduled_at_utc
    from jsonb_to_recordset(p_pigeons) as x(position int, public_id text, recipient_name text, recipient_email text,
                                            message text, slot_local text, scheduled_at_utc timestamptz);
  get diagnostics v_count = row_count;

  if v_count <> (p_order ->> 'package_size')::int then
    raise exception 'PIGEON_COUNT_MISMATCH: expected %, got %', p_order ->> 'package_size', v_count;
  end if;

  return jsonb_build_object('order_id', v_order_id, 'expires_at', v_expires);
end;
$$;

-- Called only after the server has confirmed with Razorpay that a payment is
-- CAPTURED. Atomically: records the payment, marks the order PAID (once),
-- activates the pigeons with their token hashes, and queues the sender's
-- confirmation email. Safe to call any number of times for the same payment.
--
-- p_payment: { id, order_id (razorpay), amount, currency, status, method, raw }
-- p_tokens:  [{ pigeon_id, nonce, hash }, ...] one per pigeon in the order
create or replace function public.confirm_order_payment(
  p_order_id  uuid,
  p_payment   jsonb,
  p_tokens    jsonb
)
returns text
language plpgsql
set search_path = public
as $$
declare
  o          orders%rowtype;
  v_pay_id   text := p_payment ->> 'id';
  v_count    int;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if coalesce(p_payment ->> 'status', '') <> 'captured' then
    raise exception 'PAYMENT_NOT_CAPTURED';
  end if;

  if (p_payment ->> 'order_id') is distinct from o.razorpay_order_id then
    raise exception 'RAZORPAY_ORDER_MISMATCH';
  end if;

  -- Record the payment. Status only moves forward to captured.
  insert into payments (razorpay_payment_id, order_id, razorpay_order_id, amount_paise, currency, status, method, raw)
  values (v_pay_id, o.id, o.razorpay_order_id, (p_payment ->> 'amount')::int, p_payment ->> 'currency',
          'captured', p_payment ->> 'method', p_payment -> 'raw')
  on conflict (razorpay_payment_id) do update
     set status = 'captured',
         order_id = excluded.order_id,
         method = coalesce(excluded.method, payments.method),
         raw = coalesce(excluded.raw, payments.raw),
         updated_at = now()
   where payments.status <> 'refunded';

  if o.status = 'PAID' then
    if o.paid_payment_id = v_pay_id then
      return 'ALREADY_PAID';
    end if;
    -- A second captured payment for an order that is already paid.
    update payments set flag = 'DUPLICATE_PAYMENT', updated_at = now()
     where razorpay_payment_id = v_pay_id and flag is null;
    if found then
      insert into admin_alerts (kind, message, detail)
      values ('DUPLICATE_PAYMENT',
              'Order ' || o.public_ref || ' received a second captured payment ' || v_pay_id || '. Refund it.',
              jsonb_build_object('order_id', o.id, 'payment_id', v_pay_id));
    end if;
    return 'DUPLICATE_PAYMENT';
  end if;

  if o.status not in ('PENDING_PAYMENT', 'EXPIRED') then
    update payments set flag = 'ORDER_NOT_PAYABLE', updated_at = now()
     where razorpay_payment_id = v_pay_id and flag is null;
    if found then
      insert into admin_alerts (kind, message, detail)
      values ('ORDER_NOT_PAYABLE',
              'Captured payment ' || v_pay_id || ' for order ' || o.public_ref || ' in status ' || o.status,
              jsonb_build_object('order_id', o.id, 'payment_id', v_pay_id));
    end if;
    return 'ORDER_NOT_PAYABLE';
  end if;

  if (p_payment ->> 'amount')::int <> o.amount_paise or (p_payment ->> 'currency') <> o.currency then
    update payments set flag = 'AMOUNT_MISMATCH', updated_at = now()
     where razorpay_payment_id = v_pay_id and flag is null;
    if found then
      insert into admin_alerts (kind, message, detail)
      values ('AMOUNT_MISMATCH',
              'Payment ' || v_pay_id || ' amount ' || (p_payment ->> 'amount') || ' ' || (p_payment ->> 'currency')
                || ' does not match order ' || o.public_ref || ' (' || o.amount_paise || ' ' || o.currency || ')',
              jsonb_build_object('order_id', o.id, 'payment_id', v_pay_id));
    end if;
    return 'AMOUNT_MISMATCH';
  end if;

  -- PENDING_PAYMENT or EXPIRED with a matching captured payment: honour it.
  -- (A late capture after expiry is honoured at the snapshot price; Q5 default.)
  update orders
     set status = 'PAID', paid_payment_id = v_pay_id, paid_at = now(), updated_at = now()
   where id = o.id;

  update pigeons p
     set status = 'SCHEDULED',
         recipient_token_nonce = t.nonce,
         recipient_token_hash = t.hash,
         next_attempt_at = p.scheduled_at_utc,
         updated_at = now()
    from jsonb_to_recordset(p_tokens) as t(pigeon_id uuid, nonce text, hash text)
   where p.id = t.pigeon_id
     and p.order_id = o.id
     and p.status = 'PENDING_PAYMENT';
  get diagnostics v_count = row_count;

  if v_count <> o.package_size then
    raise exception 'TOKEN_COUNT_MISMATCH: expected %, activated %', o.package_size, v_count;
  end if;

  insert into delivery_events (pigeon_id, attempt, event_type, detail)
  select p.id, 0, 'SCHEDULED', jsonb_build_object('payment_id', v_pay_id)
    from pigeons p where p.order_id = o.id;

  insert into email_outbox (kind, order_id, idempotency_key)
  values ('ORDER_CONFIRMATION', o.id, 'order-confirmation/' || o.id)
  on conflict (idempotency_key) do nothing;

  return 'ACTIVATED';
end;
$$;

-- Records a failed payment attempt without ever downgrading a captured one.
create or replace function public.record_payment_failure(p_payment jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select id into v_order_id from orders where razorpay_order_id = p_payment ->> 'order_id';

  insert into payments (razorpay_payment_id, order_id, razorpay_order_id, amount_paise, currency, status, method,
                        error_description, raw)
  values (p_payment ->> 'id', v_order_id, p_payment ->> 'order_id', coalesce((p_payment ->> 'amount')::int, 0),
          coalesce(p_payment ->> 'currency', 'INR'), 'failed', p_payment ->> 'method',
          p_payment ->> 'error_description', p_payment -> 'raw')
  on conflict (razorpay_payment_id) do update
     set status = 'failed',
         error_description = excluded.error_description,
         raw = excluded.raw,
         updated_at = now()
   where payments.status not in ('captured', 'refunded');

  return 'RECORDED';
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery scheduler (called by the `deliver` Edge Function)
-- ---------------------------------------------------------------------------

-- Atomically claims up to p_limit due pigeons. SKIP LOCKED means concurrent
-- scheduler runs never claim the same row. Rows stuck in PROCESSING past their
-- lease (a crashed run) are reclaimed; the email idempotency key stops a
-- duplicate send. The transaction ends when this function returns, so no lock
-- is held while emails are being sent.
create or replace function public.claim_due_pigeons(p_limit int, p_lease_seconds int)
returns table (
  pigeon_id              uuid,
  claim_id               uuid,
  attempt                int,
  send_generation        int,
  public_id              text,
  recipient_name         text,
  recipient_email        text,
  slot_local             text,
  recipient_token_nonce  text,
  sender_name            text
)
language sql
volatile
set search_path = public
as $$
  with due as (
    select p.id
      from pigeons p
      join orders o on o.id = p.order_id
     where o.status = 'PAID'
       and p.scheduled_at_utc <= now()
       and p.recipient_token_nonce is not null
       and ((p.status = 'SCHEDULED' and p.next_attempt_at <= now())
         or (p.status = 'PROCESSING' and p.locked_until < now()))
     order by p.scheduled_at_utc, p.position, p.id
     limit greatest(p_limit, 0)
       for update of p skip locked
  ),
  claimed as (
    update pigeons p
       set status = 'PROCESSING',
           attempts = p.attempts + 1,
           claim_id = gen_random_uuid(),
           locked_until = now() + make_interval(secs => p_lease_seconds),
           updated_at = now()
      from due
     where p.id = due.id
    returning p.id, p.claim_id, p.attempts, p.send_generation, p.public_id, p.recipient_name,
              p.recipient_email, p.slot_local, p.recipient_token_nonce, p.order_id
  )
  select c.id, c.claim_id, c.attempts, c.send_generation, c.public_id, c.recipient_name,
         c.recipient_email, c.slot_local, c.recipient_token_nonce, o.sender_name
    from claimed c
    join orders o on o.id = c.order_id;
$$;

-- Records the outcome of one send attempt in its own short transaction.
-- p_outcome: ACCEPTED | RETRY | THROTTLED | PERMANENT_FAILURE
create or replace function public.record_pigeon_attempt(
  p_pigeon_id            uuid,
  p_claim_id             uuid,
  p_outcome              text,
  p_provider_message_id  text default null,
  p_error                text default null,
  p_max_attempts         int  default 8,
  p_retry_after_seconds  int  default null
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v        pigeons%rowtype;
  v_delay  int;
begin
  select * into v from pigeons where id = p_pigeon_id for update;
  if not found then
    return 'NOT_FOUND';
  end if;

  -- Another run reclaimed this pigeon after our lease expired; its result wins.
  if v.status <> 'PROCESSING' or v.claim_id is distinct from p_claim_id then
    insert into delivery_events (pigeon_id, attempt, event_type, detail)
    values (v.id, v.attempts, 'STALE_RESULT_IGNORED',
            jsonb_build_object('outcome', p_outcome, 'provider_message_id', p_provider_message_id));
    return 'STALE';
  end if;

  if p_outcome = 'ACCEPTED' then
    update pigeons
       set status = 'EMAIL_ACCEPTED', provider_message_id = p_provider_message_id, email_accepted_at = now(),
           locked_until = null, claim_id = null, failure_reason = null, updated_at = now()
     where id = v.id;
    insert into delivery_events (pigeon_id, attempt, event_type, detail)
    values (v.id, v.attempts, 'EMAIL_ACCEPTED', jsonb_build_object('provider_message_id', p_provider_message_id));
    return 'EMAIL_ACCEPTED';
  end if;

  if p_outcome = 'THROTTLED' then
    -- Provider rate limit: retry soon and do not count it as an attempt.
    update pigeons
       set status = 'SCHEDULED', attempts = greatest(v.attempts - 1, 0),
           next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 2), 1)),
           locked_until = null, claim_id = null, updated_at = now()
     where id = v.id;
    insert into delivery_events (pigeon_id, attempt, event_type, detail)
    values (v.id, v.attempts, 'THROTTLED', jsonb_build_object('retry_after_seconds', p_retry_after_seconds));
    return 'SCHEDULED';
  end if;

  if p_outcome = 'RETRY' and v.attempts < p_max_attempts then
    -- Exponential backoff: 30s, 60s, 2m, 4m, 8m, 16m, then capped at 30m.
    v_delay := least(30 * (power(2, greatest(v.attempts - 1, 0)))::int, 1800);
    update pigeons
       set status = 'SCHEDULED', next_attempt_at = now() + make_interval(secs => v_delay),
           failure_reason = left(p_error, 500), locked_until = null, claim_id = null, updated_at = now()
     where id = v.id;
    insert into delivery_events (pigeon_id, attempt, event_type, detail)
    values (v.id, v.attempts, 'ATTEMPT_FAILED_WILL_RETRY',
            jsonb_build_object('error', left(p_error, 1000), 'retry_in_seconds', v_delay));
    return 'SCHEDULED';
  end if;

  -- PERMANENT_FAILURE, or retries exhausted: dead letter + admin alert.
  update pigeons
     set status = 'FAILED', failure_reason = left(coalesce(p_error, 'unknown error'), 500),
         locked_until = null, claim_id = null, updated_at = now()
   where id = v.id;
  insert into delivery_events (pigeon_id, attempt, event_type, detail)
  values (v.id, v.attempts, 'FAILED', jsonb_build_object('error', left(p_error, 1000), 'outcome', p_outcome));
  insert into admin_alerts (kind, message, detail)
  values ('DELIVERY_FAILED',
          'Pigeon ' || v.public_id || ' failed after ' || v.attempts || ' attempt(s): ' || left(coalesce(p_error, 'unknown'), 200),
          jsonb_build_object('pigeon_id', v.id, 'public_id', v.public_id));
  return 'FAILED';
end;
$$;

create or replace function public.claim_due_outbox(p_limit int, p_lease_seconds int)
returns table (outbox_id uuid, claim_id uuid, attempt int, kind text, order_id uuid, idempotency_key text)
language sql
volatile
set search_path = public
as $$
  with due as (
    select e.id
      from email_outbox e
     where (e.status = 'PENDING' and e.next_attempt_at <= now())
        or (e.status = 'PROCESSING' and e.locked_until < now())
     order by e.next_attempt_at, e.id
     limit greatest(p_limit, 0)
       for update skip locked
  )
  update email_outbox e
     set status = 'PROCESSING', attempts = e.attempts + 1, claim_id = gen_random_uuid(),
         locked_until = now() + make_interval(secs => p_lease_seconds)
    from due
   where e.id = due.id
  returning e.id, e.claim_id, e.attempts, e.kind, e.order_id, e.idempotency_key;
$$;

create or replace function public.record_outbox_attempt(
  p_outbox_id            uuid,
  p_claim_id             uuid,
  p_outcome              text,
  p_provider_message_id  text default null,
  p_error                text default null,
  p_max_attempts         int  default 8,
  p_retry_after_seconds  int  default null
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v        email_outbox%rowtype;
  v_delay  int;
begin
  select * into v from email_outbox where id = p_outbox_id for update;
  if not found or v.status <> 'PROCESSING' or v.claim_id is distinct from p_claim_id then
    return 'STALE';
  end if;

  if p_outcome = 'ACCEPTED' then
    update email_outbox
       set status = 'SENT', provider_message_id = p_provider_message_id, sent_at = now(),
           locked_until = null, claim_id = null, last_error = null
     where id = v.id;
    return 'SENT';
  end if;

  if p_outcome = 'THROTTLED' then
    update email_outbox
       set status = 'PENDING', attempts = greatest(v.attempts - 1, 0),
           next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 2), 1)),
           locked_until = null, claim_id = null
     where id = v.id;
    return 'PENDING';
  end if;

  if p_outcome = 'RETRY' and v.attempts < p_max_attempts then
    v_delay := least(30 * (power(2, greatest(v.attempts - 1, 0)))::int, 1800);
    update email_outbox
       set status = 'PENDING', next_attempt_at = now() + make_interval(secs => v_delay),
           last_error = left(p_error, 500), locked_until = null, claim_id = null
     where id = v.id;
    return 'PENDING';
  end if;

  update email_outbox
     set status = 'FAILED', last_error = left(coalesce(p_error, 'unknown error'), 500),
         locked_until = null, claim_id = null
   where id = v.id;
  insert into admin_alerts (kind, message, detail)
  values ('CONFIRMATION_EMAIL_FAILED', 'Order confirmation email failed: ' || left(coalesce(p_error, 'unknown'), 200),
          jsonb_build_object('outbox_id', v.id, 'order_id', v.order_id));
  return 'FAILED';
end;
$$;

-- Applies an email-provider webhook event (delivered / bounced / delayed /
-- complained) to the pigeon it belongs to. Returns NOT_FOUND when no email
-- with that provider id is known yet.
create or replace function public.apply_email_event(p_message_id text, p_event_type text, p_detail jsonb)
returns text
language plpgsql
set search_path = public
as $$
declare
  v pigeons%rowtype;
begin
  select * into v from pigeons where provider_message_id = p_message_id for update;

  if not found then
    if p_event_type in ('email.bounced', 'email.failed') then
      update email_outbox set status = 'BOUNCED', last_error = left(p_detail::text, 500)
       where provider_message_id = p_message_id and status = 'SENT';
      if found then
        insert into admin_alerts (kind, message, detail)
        values ('CONFIRMATION_EMAIL_BOUNCED', 'An order confirmation email bounced',
                jsonb_build_object('provider_message_id', p_message_id));
        return 'OUTBOX_BOUNCED';
      end if;
    end if;
    if exists (select 1 from email_outbox where provider_message_id = p_message_id) then
      return 'OUTBOX_IGNORED';
    end if;
    return 'NOT_FOUND';
  end if;

  if p_event_type = 'email.delivered' then
    if v.status = 'EMAIL_ACCEPTED' then
      update pigeons set status = 'DELIVERED_BY_PROVIDER', delivered_at = now(), updated_at = now() where id = v.id;
    end if;
    insert into delivery_events (pigeon_id, attempt, event_type, detail)
    values (v.id, v.attempts, 'PROVIDER_DELIVERED', p_detail);

  elsif p_event_type in ('email.bounced', 'email.failed') then
    -- A bounce can arrive after "delivered" (async bounce); the bounce wins.
    if v.status in ('EMAIL_ACCEPTED', 'DELIVERED_BY_PROVIDER') then
      update pigeons
         set status = 'FAILED',
             failure_reason = case when p_event_type = 'email.bounced' then 'Bounced by recipient mail server'
                                   else 'Rejected by email provider' end,
             updated_at = now()
       where id = v.id;
      insert into admin_alerts (kind, message, detail)
      values ('DELIVERY_BOUNCED', 'Pigeon ' || v.public_id || ' bounced (' || p_event_type || ')',
              jsonb_build_object('pigeon_id', v.id, 'public_id', v.public_id));
    end if;
    insert into delivery_events (pigeon_id, attempt, event_type, detail)
    values (v.id, v.attempts, case when p_event_type = 'email.bounced' then 'PROVIDER_BOUNCED' else 'PROVIDER_FAILED' end, p_detail);

  elsif p_event_type = 'email.delivery_delayed' then
    insert into delivery_events (pigeon_id, attempt, event_type, detail)
    values (v.id, v.attempts, 'PROVIDER_DELAYED', p_detail);

  elsif p_event_type = 'email.complained' then
    insert into delivery_events (pigeon_id, attempt, event_type, detail)
    values (v.id, v.attempts, 'PROVIDER_COMPLAINED', p_detail);
    insert into admin_alerts (kind, message, detail)
    values ('SPAM_COMPLAINT', 'Recipient of pigeon ' || v.public_id || ' marked it as spam',
            jsonb_build_object('pigeon_id', v.id, 'public_id', v.public_id));

  else
    return 'IGNORED';
  end if;

  return 'APPLIED';
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions
-- ---------------------------------------------------------------------------

-- Re-queue a FAILED pigeon, optionally to a corrected address. Bumps
-- send_generation so the provider idempotency key changes.
create or replace function public.requeue_pigeon(p_pigeon_id uuid, p_new_email text default null)
returns text
language plpgsql
set search_path = public
as $$
declare
  v pigeons%rowtype;
begin
  select * into v from pigeons where id = p_pigeon_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if v.status <> 'FAILED' then return 'NOT_FAILED'; end if;

  update pigeons
     set status = 'SCHEDULED', attempts = 0, send_generation = v.send_generation + 1,
         recipient_email = coalesce(nullif(trim(p_new_email), ''), v.recipient_email),
         next_attempt_at = now(), provider_message_id = null, failure_reason = null,
         locked_until = null, claim_id = null, updated_at = now()
   where id = v.id;
  insert into delivery_events (pigeon_id, attempt, event_type, detail)
  values (v.id, v.attempts, 'REQUEUED',
          jsonb_build_object('previous_provider_message_id', v.provider_message_id,
                             'email_changed', p_new_email is not null and trim(p_new_email) <> ''));
  return 'SCHEDULED';
end;
$$;

create or replace function public.cancel_pigeon(p_pigeon_id uuid, p_reason text default null)
returns text
language plpgsql
set search_path = public
as $$
declare
  v pigeons%rowtype;
begin
  select * into v from pigeons where id = p_pigeon_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if v.status not in ('PENDING_PAYMENT', 'SCHEDULED', 'FAILED') then return 'NOT_CANCELLABLE'; end if;

  update pigeons set status = 'CANCELLED', failure_reason = left(p_reason, 500), updated_at = now() where id = v.id;
  insert into delivery_events (pigeon_id, attempt, event_type, detail)
  values (v.id, v.attempts, 'CANCELLED', jsonb_build_object('reason', p_reason, 'previous_status', v.status));
  return 'CANCELLED';
end;
$$;

-- ---------------------------------------------------------------------------
-- Pigeon Universe
-- ---------------------------------------------------------------------------

create or replace function public.random_universe_pigeon(p_exclude uuid default null)
returns table (id uuid, message text, from_name text, to_name text, released_at timestamptz)
language sql
volatile
set search_path = public
as $$
  select r.id, r.message, r.from_name, r.to_name, r.released_at
    from universe_releases r
   where r.moderation_status = 'APPROVED'
     and (p_exclude is null or r.id <> p_exclude)
   order by random()
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Admin dashboard numbers in one round trip
-- ---------------------------------------------------------------------------

create or replace function public.admin_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'orders', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                 from (select status, count(*) as n from orders group by status) s),
    'pigeons', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                  from (select status, count(*) as n from pigeons group by status) s),
    'paid_revenue_paise', (select coalesce(sum(amount_paise), 0) from orders where status = 'PAID'),
    'slots', (select coalesce(jsonb_object_agg(slot_local, n), '{}'::jsonb)
                from (select slot_local, count(*) as n from pigeons
                       where status not in ('PENDING_PAYMENT', 'CANCELLED') group by slot_local) s),
    'universe', (select coalesce(jsonb_object_agg(moderation_status, n), '{}'::jsonb)
                   from (select moderation_status, count(*) as n from universe_releases group by moderation_status) s),
    'outbox', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                 from (select status, count(*) as n from email_outbox group by status) s),
    'due_now', (select count(*) from pigeons p join orders o on o.id = p.order_id
                 where o.status = 'PAID' and p.status = 'SCHEDULED' and p.scheduled_at_utc <= now()),
    'unresolved_alerts', (select count(*) from admin_alerts where resolved_at is null)
  );
$$;

-- ---------------------------------------------------------------------------
-- Lock everything down: RLS on, no policies, no anon/authenticated access.
-- Only the service role (which bypasses RLS) is used, from server code.
-- Remember to repeat the REVOKE block in any future migration that adds
-- tables or functions.
-- ---------------------------------------------------------------------------

alter table public.orders            enable row level security;
alter table public.pigeons           enable row level security;
alter table public.payments          enable row level security;
alter table public.webhook_events    enable row level security;
alter table public.delivery_events   enable row level security;
alter table public.email_outbox      enable row level security;
alter table public.universe_releases enable row level security;
alter table public.admin_alerts      enable row level security;
alter table public.scheduler_runs    enable row level security;

revoke execute on all functions in schema public from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'revoke execute on all functions in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from public, anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema public to service_role';
  end if;
end;
$$;
