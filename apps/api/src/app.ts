import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./env";
import { registerErrorHandler } from "./middleware/errorHandler";
import { authRoutes } from "./modules/auth/auth.routes";
import { pricingRoutes } from "./modules/pricing/pricing.routes";
import { orderRoutes } from "./modules/orders/orders.routes";
import { dispatchRoutes } from "./modules/dispatch/dispatch.routes";
import { custodyRoutes } from "./modules/custody/custody.routes";
import { driversRoutes } from "./modules/drivers/drivers.routes";
import { adminRoutes } from "./modules/admin/admin.routes";
import { paymentsRoutes } from "./modules/payments/payments.routes";
import { trackingRoutes } from "./modules/tracking/tracking.routes";
import { claimsRoutes } from "./modules/claims/claims.routes";
import { ratingsRoutes } from "./modules/ratings/ratings.routes";

export function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : true,
  });

  app.register(cors, {
    origin: [env.ADMIN_ORIGIN, /^http:\/\/localhost:\d+$/],
    credentials: true,
  });

  // Gateway-level rate limiting (02-architecture.md §11: "per-user and
  // per-IP limits at the gateway, stricter on auth, offer-accept, and
  // location endpoints"). This registers the per-IP half — individual
  // routes below override with stricter limits via `config.rateLimit`.
  // Per-user limiting would need the JWT decoded before this plugin's
  // `onRequest` hook runs (ahead of each route's `requireAuth` preHandler),
  // which is a reasonable next increment, not implemented here.
  app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  registerErrorHandler(app);

  // Deliberately exempt from rate limiting: @fastify/rate-limit attaches its
  // per-route setup via an `onRoute` hook inside its own (deferred, async)
  // plugin registration, so only routes declared *after* that plugin body
  // has actually run are captured — every route below, declared inside its
  // own `app.register(...)` module, qualifies; `/health`, declared directly
  // and synchronously here, does not. Verified live via `curl -i`: this
  // route never carries `x-ratelimit-*` headers while every other route
  // does. Leaving it this way rather than "fixing" it — health/liveness
  // checks (load balancers, uptime monitors) are conventionally excluded
  // from rate limiting anyway.
  app.get("/health", async () => ({ status: "ok", env: env.NODE_ENV }));

  app.register(authRoutes);
  app.register(pricingRoutes);
  app.register(orderRoutes);
  app.register(dispatchRoutes);
  app.register(custodyRoutes);
  app.register(driversRoutes);
  app.register(adminRoutes);
  app.register(paymentsRoutes);
  app.register(trackingRoutes);
  app.register(claimsRoutes);
  app.register(ratingsRoutes);

  return app;
}
