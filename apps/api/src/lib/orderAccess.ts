import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db, schema } from "../db";
import { NotFoundError, ForbiddenError } from "./errors";
import { getAcceptedOfferForOrder } from "../modules/dispatch/dispatch.service";

export async function getCustomerProfileId(userId: string) {
  const profile = await db.query.customerProfiles.findFirst({ where: eq(schema.customerProfiles.userId, userId) });
  if (!profile) throw new NotFoundError("CustomerProfile", userId);
  return profile.id;
}

export async function getDriverId(userId: string) {
  const driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.userId, userId) });
  if (!driver) throw new NotFoundError("Driver", userId);
  return driver.id;
}

// Object-level authorization shared across every order-scoped GET route:
// a customer may only access their own orders, a driver only the order
// they're currently the accepted driver for (direct or via a route batch);
// back-office roles (DISPATCHER/OPS_MANAGER/SUPER_ADMIN/FINANCE) have
// unrestricted read access. Mirrors the pattern orders.routes.ts's
// GET /v1/orders/:id already established after a prior IDOR fix there —
// centralized here so sibling routes (tracking/claims/ratings) can't drift
// from it independently.
export async function assertOrderAccess(req: FastifyRequest, orderId: string): Promise<void> {
  if (req.auth!.role === "CUSTOMER") {
    const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
    if (!order) throw new NotFoundError("Order", orderId);
    const customerProfileId = await getCustomerProfileId(req.auth!.userId);
    if (order.customerProfileId !== customerProfileId) {
      throw new ForbiddenError("You do not have access to this order");
    }
    return;
  }
  if (req.auth!.role === "DRIVER") {
    const driverId = await getDriverId(req.auth!.userId);
    const accepted = await getAcceptedOfferForOrder(db, orderId);
    if (!accepted || accepted.driverId !== driverId) {
      throw new ForbiddenError("You do not have access to this order");
    }
  }
}
