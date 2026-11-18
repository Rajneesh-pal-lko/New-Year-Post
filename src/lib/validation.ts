import { z } from "zod";
import { isValidSlot } from "@shared/slots";
import { isPackageSize } from "./packages";

// Shared by the browser (live feedback) and the server (the real check).
// The server never trusts that the browser ran these.

export const MESSAGE_MAX = 500;
export const NAME_MAX = 60;

/**
 * Length as a person sees it: one emoji or one Hindi syllable cluster is one
 * character. Intl.Segmenter exists in Node 20+ and current browsers; the
 * fallback counts code points, which is never lower than graphemes, so it can
 * only be stricter, never let an over-long message through.
 */
export function countGraphemes(value: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) n++;
    return n;
  }
  return Array.from(value).length;
}

// Control characters other than newline are removed; Windows newlines become \n.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g;

export function normalizeMessage(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function normalizeName(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.normalize("NFC").replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

export function normalizeEmail(value: unknown): unknown {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

export const emailSchema = z.preprocess(
  normalizeEmail,
  z.email({ error: "Enter a valid email address" }).max(254, { error: "That email address is too long" }),
);

export const nameSchema = z.preprocess(
  normalizeName,
  z
    .string({ error: "Enter a name" })
    .min(1, { error: "Enter a name" })
    .refine((v) => countGraphemes(v) <= NAME_MAX, { error: `Keep the name under ${NAME_MAX} characters` }),
);

export const messageSchema = z.preprocess(
  normalizeMessage,
  z
    .string({ error: "Write a message" })
    .min(1, { error: "Write a message" })
    .refine((v) => countGraphemes(v) <= MESSAGE_MAX, { error: `Keep the message to ${MESSAGE_MAX} characters` }),
);

export const slotSchema = z.string().refine(isValidSlot, { error: "Choose a delivery time" });

export const pigeonInputSchema = z.object({
  recipientName: nameSchema,
  recipientEmail: emailSchema,
  message: messageSchema,
  slot: slotSchema,
});

export const orderInputSchema = z
  .object({
    packageSize: z.number().refine(isPackageSize, { error: "Choose a package" }),
    sender: z.object({ name: nameSchema, email: emailSchema }),
    allowPublicRelease: z.boolean(),
    acceptTerms: z.literal(true, { error: "Please accept the terms to continue" }),
    pigeons: z.array(pigeonInputSchema).min(1).max(20),
  })
  .superRefine((value, ctx) => {
    if (value.pigeons.length !== value.packageSize) {
      ctx.addIssue({
        code: "custom",
        path: ["pigeons"],
        message: `This package needs exactly ${value.packageSize} pigeon${value.packageSize === 1 ? "" : "s"}`,
      });
    }
  });

export type OrderInput = z.infer<typeof orderInputSchema>;
export type PigeonInput = z.infer<typeof pigeonInputSchema>;

/** Flattens zod issues to { "pigeons.2.message": "Write a message" }. */
export function issuesToFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
