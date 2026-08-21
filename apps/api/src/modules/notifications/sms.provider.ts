import { randomUUID } from "crypto";
import twilio from "twilio";
import { env } from "../../env";

export interface SmsProvider {
  send(to: string, body: string): Promise<{ providerMessageRef: string }>;
}

/**
 * Default, offline-testable provider — logs instead of sending. What CI and
 * the test suite run against; no Twilio account needed to pass.
 */
export class MockSmsProvider implements SmsProvider {
  async send(to: string, body: string) {
    // eslint-disable-next-line no-console
    console.log(`[sms:mock] -> ${to}: ${body}`);
    return { providerMessageRef: `mock_sms_${randomUUID()}` };
  }
}

/** Real Twilio implementation, activated by SMS_PROVIDER=twilio. */
export class TwilioSmsProvider implements SmsProvider {
  private client: ReturnType<typeof twilio>;

  constructor(
    accountSid: string,
    authToken: string,
    private fromNumber: string
  ) {
    this.client = twilio(accountSid, authToken);
  }

  async send(to: string, body: string) {
    const message = await this.client.messages.create({ to, from: this.fromNumber, body });
    return { providerMessageRef: message.sid };
  }
}

function buildSmsProvider(): SmsProvider {
  if (env.SMS_PROVIDER === "twilio") {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
      throw new Error("SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER");
    }
    return new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER);
  }
  return new MockSmsProvider();
}

export const smsProvider: SmsProvider = buildSmsProvider();
