import type { Metadata } from "next";
import { formatRupees } from "@shared/money";
import { SLOTS, slotLabel } from "@shared/slots";
import { formatIst } from "@/lib/campaign";
import { db } from "@/lib/db";
import { cancelPigeon, moderateRelease, requeuePigeon, resolveAlert, runDeliveryNow } from "./actions";

// /admin: one page for the owner. Protected by Basic auth (src/proxy.ts).
// Built for 1 January: is the scheduler alive, what is due, what failed,
// and the buttons to fix it.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin: Pigeon Post", robots: { index: false } };

interface Stats {
  orders: Record<string, number>;
  pigeons: Record<string, number>;
  paid_revenue_paise: number;
  slots: Record<string, number>;
  universe: Record<string, number>;
  outbox: Record<string, number>;
  due_now: number;
  unresolved_alerts: number;
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().toUpperCase();

  const [statsRes, runRes, alertsRes, failedRes, flaggedRes, releasesRes] = await Promise.all([
    db().rpc("admin_stats"),
    db().from("scheduler_runs").select("started_at, finished_at, summary").order("started_at", { ascending: false }).limit(1),
    db().from("admin_alerts").select("id, kind, message, created_at").is("resolved_at", null).order("id", { ascending: false }).limit(50),
    db()
      .from("pigeons")
      .select("id, public_id, recipient_name, recipient_email, slot_local, attempts, failure_reason, updated_at")
      .eq("status", "FAILED")
      .order("updated_at", { ascending: false })
      .limit(100),
    db().from("payments").select("razorpay_payment_id, amount_paise, flag, created_at, order_id").not("flag", "is", null).order("created_at", { ascending: false }).limit(50),
    db().from("universe_releases").select("id, message, from_name, to_name, report_count, released_at").eq("moderation_status", "PENDING").order("released_at").limit(50),
  ]);

  const stats = (statsRes.data ?? {}) as Stats;
  const lastRun = runRes.data?.[0];
  const lastRunAgeSec = lastRun ? Math.round((Date.now() - new Date(lastRun.started_at).getTime()) / 1000) : null;
  const maxSlot = Math.max(1, ...Object.values(stats.slots ?? {}));

  let lookup: { order: Record<string, unknown> | null; pigeons: Record<string, unknown>[] } | null = null;
  if (query) {
    let orderId: string | null = null;
    if (query.startsWith("PGN-")) {
      const { data } = await db().from("pigeons").select("order_id").eq("public_id", query).maybeSingle();
      orderId = data?.order_id ?? null;
    }
    const orderQuery = db().from("orders").select("id, public_ref, status, sender_name, sender_email, amount_paise, created_at, paid_at");
    const { data: order } = orderId ? await orderQuery.eq("id", orderId).maybeSingle() : await orderQuery.eq("public_ref", query).maybeSingle();
    const { data: pigeons } = order
      ? await db().from("pigeons").select("id, public_id, recipient_name, recipient_email, slot_local, status, attempts, failure_reason").eq("order_id", order.id).order("position")
      : { data: [] };
    lookup = { order, pigeons: pigeons ?? [] };
  }

  return (
    <main className="admin">
      <h1>Pigeon Post admin</h1>

      <section>
        <h2>Scheduler</h2>
        {lastRun ? (
          <p className={lastRunAgeSec! > 180 ? "notice notice--error" : "notice notice--good"}>
            Last run {lastRunAgeSec}s ago ({formatIst(new Date(lastRun.started_at))}).{" "}
            {lastRunAgeSec! > 180 && "The cron job may be stopped: check cron.job_run_details in Supabase. "}
            <code style={{ fontSize: "0.85rem" }}>{JSON.stringify(lastRun.summary)}</code>
          </p>
        ) : (
          <p className="notice">No scheduler runs recorded yet. Set up supabase/setup/cron.sql.</p>
        )}
        <div className="admin__stats">
          <div className="admin__stat">
            Due now, not yet sent<b>{stats.due_now ?? 0}</b>
          </div>
          <div className="admin__stat">
            Paid revenue<b>{formatRupees(stats.paid_revenue_paise ?? 0)}</b>
          </div>
          <div className="admin__stat">
            Unresolved alerts<b>{stats.unresolved_alerts ?? 0}</b>
          </div>
        </div>
        <form action={runDeliveryNow} style={{ display: "block", marginTop: "1rem" }}>
          <button className="button button--primary" type="submit">
            Run delivery now
          </button>{" "}
          <span className="field__hint">Triggers one extra scheduler run. Safe to press repeatedly.</span>
        </form>
      </section>

      <section>
        <h2>Counts</h2>
        <table>
          <tbody>
            <tr>
              <th>Orders</th>
              <td>{fmtCounts(stats.orders)}</td>
            </tr>
            <tr>
              <th>Pigeons</th>
              <td>{fmtCounts(stats.pigeons)}</td>
            </tr>
            <tr>
              <th>Confirmation emails</th>
              <td>{fmtCounts(stats.outbox)}</td>
            </tr>
            <tr>
              <th>Universe</th>
              <td>{fmtCounts(stats.universe)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Alerts</h2>
        {alertsRes.data?.length ? (
          <>
            <form action={resolveAlert}>
              <input type="hidden" name="alertId" value="all" />
              <button className="button button--quiet" type="submit">
                Mark all resolved
              </button>
            </form>
            <table>
              <tbody>
                {alertsRes.data.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatIst(new Date(a.created_at))}</td>
                    <td>
                      <strong>{a.kind}</strong>
                      <br />
                      {a.message}
                    </td>
                    <td>
                      <form action={resolveAlert}>
                        <input type="hidden" name="alertId" value={a.id} />
                        <button className="button button--quiet" type="submit">
                          Resolve
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p>No open alerts.</p>
        )}
      </section>

      <section>
        <h2>Failed pigeons</h2>
        {failedRes.data?.length ? (
          <table>
            <thead>
              <tr>
                <th>Pigeon</th>
                <th>Recipient</th>
                <th>Reason</th>
                <th>Fix</th>
              </tr>
            </thead>
            <tbody>
              {failedRes.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.public_id}
                    <br />
                    {slotLabel(p.slot_local)}, {p.attempts} attempts
                  </td>
                  <td>
                    {p.recipient_name}
                    <br />
                    {p.recipient_email}
                  </td>
                  <td>{p.failure_reason}</td>
                  <td>
                    <form action={requeuePigeon}>
                      <input type="hidden" name="pigeonId" value={p.id} />
                      <input type="email" name="newEmail" placeholder="Corrected email (optional)" style={{ maxWidth: "14rem" }} />{" "}
                      <button className="button button--quiet" type="submit">
                        Send again
                      </button>
                    </form>{" "}
                    <form action={cancelPigeon}>
                      <input type="hidden" name="pigeonId" value={p.id} />
                      <button className="button button--quiet" type="submit">
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>None.</p>
        )}
      </section>

      <section>
        <h2>Payments needing attention</h2>
        {flaggedRes.data?.length ? (
          <table>
            <tbody>
              {flaggedRes.data.map((p) => (
                <tr key={p.razorpay_payment_id}>
                  <td>{p.razorpay_payment_id}</td>
                  <td>{formatRupees(p.amount_paise)}</td>
                  <td>{p.flag}</td>
                  <td>{formatIst(new Date(p.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>None. Duplicate or mismatched payments show up here; refund them from the Razorpay dashboard.</p>
        )}
      </section>

      <section>
        <h2>Universe: waiting for review</h2>
        {releasesRes.data?.length ? (
          <table>
            <tbody>
              {releasesRes.data.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "pre-wrap", maxWidth: "36rem" }}>
                    {r.to_name || r.from_name ? (
                      <small>
                        {r.from_name} to {r.to_name}
                        <br />
                      </small>
                    ) : null}
                    {r.message}
                    {r.report_count > 0 && <small style={{ color: "var(--bad)" }}> (reported {r.report_count}×)</small>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <form action={moderateRelease}>
                      <input type="hidden" name="releaseId" value={r.id} />
                      <input type="hidden" name="decision" value="APPROVED" />
                      <button className="button button--quiet" type="submit">
                        Approve
                      </button>
                    </form>{" "}
                    <form action={moderateRelease}>
                      <input type="hidden" name="releaseId" value={r.id} />
                      <input type="hidden" name="decision" value="REJECTED" />
                      <button className="button button--quiet" type="submit">
                        Reject
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Nothing to review.</p>
        )}
      </section>

      <section>
        <h2>Find an order</h2>
        <form method="get" style={{ display: "flex", gap: "0.5rem" }}>
          <input name="q" defaultValue={q ?? ""} placeholder="PP-… or PGN-…" style={{ minHeight: "2.4rem", padding: "0 0.6rem" }} />
          <button className="button button--quiet" type="submit">
            Find
          </button>
        </form>
        {lookup && !lookup.order && <p>No order found for {query}.</p>}
        {lookup?.order && (
          <>
            <p>
              <strong>{String(lookup.order.public_ref)}</strong>: {String(lookup.order.status)}, {String(lookup.order.sender_name)} (
              {String(lookup.order.sender_email)}), {formatRupees(Number(lookup.order.amount_paise))}
            </p>
            <table>
              <tbody>
                {lookup.pigeons.map((p) => (
                  <tr key={String(p.id)}>
                    <td>{String(p.public_id)}</td>
                    <td>
                      {String(p.recipient_name)}
                      <br />
                      {String(p.recipient_email)}
                    </td>
                    <td>{slotLabel(String(p.slot_local))}</td>
                    <td>
                      {String(p.status)}
                      {p.failure_reason ? `: ${String(p.failure_reason)}` : ""}
                    </td>
                    <td>
                      {["PENDING_PAYMENT", "SCHEDULED", "FAILED"].includes(String(p.status)) && (
                        <form action={cancelPigeon}>
                          <input type="hidden" name="pigeonId" value={String(p.id)} />
                          <input type="hidden" name="reason" value="Cancelled by admin after review" />
                          <button className="button button--quiet" type="submit">
                            Cancel pigeon
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <h2>Slot load on delivery day</h2>
        <p className="field__hint">Paid pigeons per half-hour slot. Size the email rate limit for the biggest bar.</p>
        <div className="slot-bars">
          {SLOTS.filter((s) => (stats.slots ?? {})[s]).map((s) => {
            const n = stats.slots[s];
            return [
              <span key={`${s}-l`}>{slotLabel(s).replace(" (midnight)", "").replace(" (noon)", "")}</span>,
              <span key={`${s}-b`} style={{ width: `${Math.max(2, (n / maxSlot) * 100)}%` }} />,
              <span key={`${s}-n`}>{n}</span>,
            ];
          })}
        </div>
      </section>
    </main>
  );
}

function fmtCounts(counts: Record<string, number> | undefined): string {
  if (!counts || Object.keys(counts).length === 0) return "none";
  return Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}
