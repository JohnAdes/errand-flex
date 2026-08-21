import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_SECRET: z.string().min(8, "JWT_SECRET must be set to a real secret in production"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ADMIN_ORIGIN: z.string().default("http://localhost:3000"),
  OFFER_TIMEOUT_SECONDS: z.coerce.number().default(45),
  QUOTE_EXPIRY_MINUTES: z.coerce.number().default(15),

  // --- Payments (Stripe) ---
  // "mock" (default) needs no credentials and is what CI/tests run against;
  // "stripe" activates the real StripePaymentProvider (payment.provider.ts).
  PAYMENT_PROVIDER: z.enum(["mock", "stripe"]).default("mock"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),

  // --- Auth (Firebase) ---
  // "local" (default) is this codebase's self-contained JWT scheme; "firebase"
  // activates real Firebase ID token verification (middleware/auth.ts).
  AUTH_PROVIDER: z.enum(["local", "firebase"]).default("local"),
  FIREBASE_PROJECT_ID: z.string().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().default(""),
  FIREBASE_PRIVATE_KEY: z.string().default(""),

  // --- File storage (signed uploads for custody-verification photos) ---
  STORAGE_PROVIDER: z.enum(["mock", "firebase"]).default("mock"),
  FIREBASE_STORAGE_BUCKET: z.string().default(""),

  // --- SMS (Twilio) ---
  SMS_PROVIDER: z.enum(["mock", "twilio"]).default("mock"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_FROM_NUMBER: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration — check .env against .env.example");
}

export const env = parsed.data;
