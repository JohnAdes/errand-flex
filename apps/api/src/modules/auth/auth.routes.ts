import type { FastifyInstance } from "fastify";
import { z } from "zod";
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

  // NOTE: /v1/auth/verify-phone (OTP send + confirm) is in the API spec but not
  // implemented here — it requires a real SMS provider (Twilio) account. The route
  // shape/contract is documented in 02-architecture.md §6; wire it up the same way
  // as any other module here once you have Twilio credentials.
}
