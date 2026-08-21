import { randomUUID } from "crypto";
import Stripe from "stripe";
import { env } from "../../env";

export interface PaymentProvider {
  authorize(input: {
    amountCents: number;
    currency: string;
    customerRef: string;
  }): Promise<{ providerRef: string; clientSecret?: string }>;
  capture(providerRef: string, amountCents: number): Promise<void>;
  refund(providerRef: string, amountCents: number): Promise<{ providerRefundRef: string }>;
}

/**
 * Default, offline-testable payment provider. Same pattern already used
 * elsewhere in this starter kit (local JWT instead of Firebase Auth, Drizzle
 * instead of Prisma — see README "Architecture note" sections): a working
 * default with no external dependency, plus a clearly marked seam for the
 * real thing. This is what CI and the test suite run against — none of them
 * have real Stripe credentials, and shouldn't need any to pass.
 */
export class MockPaymentProvider implements PaymentProvider {
  async authorize(_input: { amountCents: number; currency: string; customerRef: string }) {
    return { providerRef: `mock_pi_${randomUUID()}` };
  }

  async capture(_providerRef: string, _amountCents: number) {
    // A real provider would call e.g. stripe.paymentIntents.capture(providerRef, { amount_to_capture: amountCents }).
  }

  async refund(_providerRef: string, _amountCents: number) {
    return { providerRefundRef: `mock_re_${randomUUID()}` };
  }
}

/**
 * Real Stripe implementation, activated by setting PAYMENT_PROVIDER=stripe
 * and a real STRIPE_SECRET_KEY.
 *
 * Important scope note: `authorize()` here creates a PaymentIntent with
 * manual capture and `automatic_payment_methods` enabled, but does NOT
 * confirm it — Stripe requires a payment method (a card, collected via
 * Stripe's client-side SDK/Elements) to confirm a PaymentIntent, and nothing
 * in this codebase's mobile apps collects one today. The `clientSecret`
 * returned here is what a real client-side integration would need to
 * complete that confirmation (Stripe's React Native SDK's
 * `confirmPayment(clientSecret, ...)`) — that mobile-side work is a
 * separate feature, not built by this class. Until it exists, calling
 * `authorizePayment` with this provider active creates a real
 * `requires_payment_method` PaymentIntent that never actually collects
 * money — verify that's the behavior you want before flipping this on
 * against a live key.
 */
export class StripePaymentProvider implements PaymentProvider {
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async authorize(input: { amountCents: number; currency: string; customerRef: string }) {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      capture_method: "manual",
      automatic_payment_methods: { enabled: true },
      metadata: { customerProfileId: input.customerRef },
    });
    return { providerRef: intent.id, clientSecret: intent.client_secret ?? undefined };
  }

  async capture(providerRef: string, amountCents: number) {
    await this.stripe.paymentIntents.capture(providerRef, { amount_to_capture: amountCents });
  }

  async refund(providerRef: string, amountCents: number) {
    const refund = await this.stripe.refunds.create({ payment_intent: providerRef, amount: amountCents });
    return { providerRefundRef: refund.id };
  }
}

function buildPaymentProvider(): PaymentProvider {
  if (env.PAYMENT_PROVIDER === "stripe") {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY to be set");
    }
    return new StripePaymentProvider(env.STRIPE_SECRET_KEY);
  }
  return new MockPaymentProvider();
}

export const paymentProvider: PaymentProvider = buildPaymentProvider();
