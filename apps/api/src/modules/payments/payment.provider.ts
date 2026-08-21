import { randomUUID } from "crypto";

export interface PaymentProvider {
  authorize(input: { amountCents: number; currency: string; customerRef: string }): Promise<{ providerRef: string }>;
  capture(providerRef: string, amountCents: number): Promise<void>;
  refund(providerRef: string, amountCents: number): Promise<{ providerRefundRef: string }>;
}

/**
 * Default, offline-testable payment provider. Same pattern already used
 * elsewhere in this starter kit (local JWT instead of Firebase Auth, Drizzle
 * instead of Prisma — see README "Architecture note" sections): a working
 * default with no external dependency, plus a clearly marked seam for the
 * real thing.
 *
 * A real `StripePaymentProvider` isn't included here because it can't be
 * verified working without a live Stripe account/API keys (`.env` only has
 * `STRIPE_SECRET_KEY="sk_test_placeholder"`), and this codebase's convention
 * (see README's testing philosophy) is to not claim something works unless
 * it was actually run. To wire up real Stripe: implement `PaymentProvider`
 * using `stripe.paymentIntents.create/capture` and Stripe's refund API, set
 * `STRIPE_SECRET_KEY` to a real key, and swap the export at the bottom of
 * this file — nothing else in the codebase needs to change, since every
 * caller goes through the `PaymentProvider` interface, not a concrete class.
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

export const paymentProvider: PaymentProvider = new MockPaymentProvider();
