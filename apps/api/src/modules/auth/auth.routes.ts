import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import * as authService from "./auth.service";

const registerCustomerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  phone: z.string().optional(),
});

const registerDriverSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const linkFirebaseSchema = z.object({
  idToken: z.string().min(1),
  role: z.enum(["CUSTOMER", "DRIVER"]),
  displayName: z.string().min(1).optional(),
  phone: z.string().optional(),
});

// Stricter than the app-wide default (app.ts) — auth endpoints are the
// classic brute-force/credential-stuffing target (02-architecture.md §11).
const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance) {
  // POST /v1/auth/register/customer
  app.post("/v1/auth/register/customer", authRateLimit, async (req, reply) => {
    const body = registerCustomerSchema.parse(req.body);
    const session = await authService.registerCustomer(body);
    reply.status(201).send(session);
  });

  // POST /v1/auth/register/driver
  app.post("/v1/auth/register/driver", authRateLimit, async (req, reply) => {
    const body = registerDriverSchema.parse(req.body);
    const session = await authService.registerDriverApplicant(body);
    reply.status(201).send(session);
  });

  // POST /v1/auth/login
  app.post("/v1/auth/login", authRateLimit, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const session = await authService.login(body.email, body.password);
    reply.status(200).send(session);
  });

  // POST /v1/auth/link-firebase-account — only meaningful once
  // AUTH_PROVIDER=firebase is active (env.ts); see auth.service.ts's
  // linkFirebaseAccount for the full flow. Rate-limited the same as
  // register/login since, like them, it's callable by anyone with an
  // arbitrary (if Firebase-verified) identity.
  app.post("/v1/auth/link-firebase-account", authRateLimit, async (req, reply) => {
    const body = linkFirebaseSchema.parse(req.body);
    const result = await authService.linkFirebaseAccount(body);
    reply.status(200).send(result);
  });

  // POST /v1/auth/verify-phone/send and /confirm — the OTP flow the API
  // spec documents (02-architecture.md §6) but this codebase previously left
  // unimplemented for lack of an SMS provider (see modules/notifications/sms.provider.ts).
  // Same rate limit as login/register: brute-forcing a 6-digit code is
  // exactly the kind of thing this limit exists to slow down.
  app.post("/v1/auth/verify-phone/send", { preHandler: [requireAuth], ...authRateLimit }, async (req, reply) => {
    const result = await authService.sendPhoneVerificationCode(req.auth!.userId);
    reply.status(200).send(result);
  });

  app.post("/v1/auth/verify-phone/confirm", { preHandler: [requireAuth], ...authRateLimit }, async (req, reply) => {
    const body = z.object({ code: z.string().length(6) }).parse(req.body);
    const result = await authService.confirmPhoneVerificationCode(req.auth!.userId, body.code);
    reply.status(200).send(result);
  });
}
