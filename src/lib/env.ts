import "server-only";

// Environment access. Getters are lazy so `next build` works without secrets;
// a missing variable fails loudly at the moment it is first needed.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export type AppEnv = "production" | "staging" | "development";

/** Anything other than an explicit staging/development value is production. */
export function appEnv(): AppEnv {
  const value = process.env.APP_ENV;
  return value === "staging" || value === "development" ? value : "production";
}

export const env = {
  get appBaseUrl() {
    return required("APP_BASE_URL").replace(/\/+$/, "");
  },
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get razorpayKeyId() {
    return required("RAZORPAY_KEY_ID");
  },
  get razorpayKeySecret() {
    return required("RAZORPAY_KEY_SECRET");
  },
  get razorpayWebhookSecret() {
    return required("RAZORPAY_WEBHOOK_SECRET");
  },
  get tokenSecret() {
    return required("TOKEN_SECRET");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get resendWebhookSecret() {
    return required("RESEND_WEBHOOK_SECRET");
  },
  get supabaseFunctionsUrl() {
    return required("SUPABASE_FUNCTIONS_URL").replace(/\/+$/, "");
  },
  get checkoutTtlMinutes() {
    const n = Number(process.env.CHECKOUT_TTL_MINUTES ?? 15);
    return Number.isInteger(n) && n >= 5 && n <= 60 ? n : 15;
  },
};
