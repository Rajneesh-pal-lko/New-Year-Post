// Email templates. Plain, personal and light on HTML: a burst of mail from a
// young domain on New Year's morning has to look like what it is, a personal
// note someone expects, not a promotion.
//
// Every user-supplied string goes through escapeHtml. Messages are never put
// in the email itself: the email only carries the private link, so the
// message stays locked until the recipient opens it on the site.

import { formatIstDate, slotLabel } from "./slots.ts";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** For subjects and other single-line contexts. */
export function oneLine(value: string, max = 60): string {
  const flat = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// "Dak Mela" palette, matching the site: rani pink, marigold, ink, paper.
const INK = "#24124D";
const PINK = "#D90B74";
const MARIGOLD = "#FFB627";
const PAPER = "#FFFFFF";

function layout(inner: string, preheader: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pigeon Post 2027</title></head>
<body style="margin:0;padding:0;background:${PINK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PINK};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${PAPER};border-radius:14px;border:3px solid ${INK};border-top:8px solid ${MARIGOLD};">
<tr><td style="padding:26px 28px 8px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-weight:800;color:${INK};font-size:22px;">Pigeon Post <span style="color:${PINK};">2027</span></td></tr>
<tr><td style="padding:8px 28px 28px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};font-size:16px;line-height:1.55;">
${inner}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${MARIGOLD};color:${INK};text-decoration:none;font-weight:700;padding:12px 24px;border:2px solid ${INK};border-radius:999px;">${escapeHtml(label)}</a></p>`;
}

export function recipientPigeonEmail(input: {
  recipientName: string;
  senderName: string;
  link: string;
}): RenderedEmail {
  const sender = oneLine(input.senderName, 40);
  const recipient = oneLine(input.recipientName, 40);
  const subject = `${sender} sent you a New Year pigeon`;
  const html = layout(
    `<p style="margin:0 0 12px 0;">Hi ${escapeHtml(recipient)},</p>
<p style="margin:0 0 12px 0;">A pigeon from <strong>${escapeHtml(sender)}</strong> has just landed with a New Year message for you.</p>
${button(input.link, "Open your pigeon")}
<p style="margin:0 0 12px 0;font-size:14px;color:#574A7D;">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(input.link)}</span></p>
<p style="margin:20px 0 0 0;font-size:13px;color:#574A7D;">This link is private to you. Pigeon Post 2027 delivers New Year messages that people write for each other. If this message is unwelcome, reply to this email and we'll look into it.</p>`,
    "It's carrying a personal message for you.",
  );
  const text = `Hi ${recipient},

A pigeon from ${sender} has just landed with a New Year message for you.

Open your pigeon: ${input.link}

This link is private to you. Pigeon Post 2027 delivers New Year messages that people write for each other. If this message is unwelcome, reply to this email and we'll look into it.`;
  return { subject, html, text };
}

export function orderConfirmationEmail(input: {
  senderName: string;
  orderRef: string;
  orderLink: string;
  amountRupees: string;
  deliveryDate: string; // YYYY-MM-DD (IST)
  pigeons: { publicId: string; recipientName: string; slot: string }[];
}): RenderedEmail {
  const sender = oneLine(input.senderName, 40);
  const count = input.pigeons.length;
  const noun = count === 1 ? "pigeon is" : "pigeons are";
  const date = formatIstDate(input.deliveryDate);
  const subject = `Your ${count === 1 ? "pigeon is" : `${count} pigeons are`} booked for ${date}`;

  const rows = input.pigeons
    .map(
      (p) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #E4DCF5;">${escapeHtml(oneLine(p.recipientName, 40))}</td><td style="padding:6px 0;border-bottom:1px solid #E4DCF5;text-align:right;white-space:nowrap;">${escapeHtml(slotLabel(p.slot))} IST</td></tr>`,
    )
    .join("");

  const html = layout(
    `<p style="margin:0 0 12px 0;">Hi ${escapeHtml(sender)},</p>
<p style="margin:0 0 12px 0;">Payment received. Your ${noun} booked to land on <strong>${escapeHtml(date)}</strong>.</p>
<p style="margin:0 0 4px 0;font-size:14px;color:#574A7D;">Order ${escapeHtml(input.orderRef)}, paid ₹${escapeHtml(input.amountRupees)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;font-size:15px;">${rows}</table>
${button(input.orderLink, "View your order")}
<p style="margin:0 0 12px 0;font-size:14px;color:#574A7D;">Keep this email. The button is your private link to check each pigeon's status and share its page on WhatsApp. Anyone with the link can see your order, so don't forward it.</p>`,
    `Your ${noun} booked for ${date}.`,
  );

  const lines = input.pigeons.map((p) => `- ${oneLine(p.recipientName, 40)}: ${slotLabel(p.slot)} IST`).join("\n");
  const text = `Hi ${sender},

Payment received. Your ${noun} booked to land on ${date}.

Order ${input.orderRef}, paid Rs ${input.amountRupees}
${lines}

View your order: ${input.orderLink}

Keep this email. The link is your private way to check each pigeon's status and share its page on WhatsApp. Anyone with the link can see your order, so don't forward it.`;
  return { subject, html, text };
}

export function alertDigestEmail(alerts: { kind: string; message: string; created_at: string }[]): RenderedEmail {
  const subject = `[Pigeon Post] ${alerts.length} alert${alerts.length === 1 ? "" : "s"}: ${alerts[0]?.kind ?? ""}`;
  const text = alerts.map((a) => `${a.created_at}  ${a.kind}\n  ${a.message}`).join("\n\n");
  const html = layout(
    `<p style="margin:0 0 12px 0;">${alerts.length} new alert${alerts.length === 1 ? "" : "s"}. Details are on the admin page.</p>
<pre style="white-space:pre-wrap;font-size:13px;background:#FFF1C7;padding:12px;border-radius:4px;">${escapeHtml(text)}</pre>`,
    `${alerts.length} new alert(s)`,
  );
  return { subject, html, text };
}
