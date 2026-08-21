import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "../../db";
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from "../../lib/errors";
import { getAcceptedOfferForOrder } from "../dispatch/dispatch.service";

/**
 * Every order this driver actually carried (single-order or as part of a
 * batch), regardless of delivery outcome — the set `recomputeDriverRatingAvg`
 * below draws from.
 */
async function getDriverOrderIds(driverId: string): Promise<string[]> {
  const directOffers = await db.query.driverOffers.findMany({
    where: and(eq(schema.driverOffers.driverId, driverId), eq(schema.driverOffers.status, "ACCEPTED"), isNotNull(schema.driverOffers.orderId)),
  });
  const batchOffers = await db.query.driverOffers.findMany({
    where: and(eq(schema.driverOffers.driverId, driverId), eq(schema.driverOffers.status, "ACCEPTED"), isNotNull(schema.driverOffers.routeBatchId)),
  });

  // One batched query instead of the previous per-offer loop.
  const batchOrderIds =
    batchOffers.length === 0
      ? []
      : (
          await db.query.routeAssignments.findMany({
            where: inArray(schema.routeAssignments.routeBatchId, batchOffers.map((o) => o.routeBatchId!)),
          })
        ).map((a) => a.orderId);

  return [...directOffers.map((o) => o.orderId!), ...batchOrderIds];
}

/** Recomputes drivers.rating_avg from every CUSTOMER-submitted rating across every order this driver carried — a real, live-computed average, not the static seeded default. */
async function recomputeDriverRatingAvg(driverId: string) {
  const orderIds = await getDriverOrderIds(driverId);
  if (orderIds.length === 0) return;

  const customerRatings = await db.query.ratings.findMany({
    where: and(inArray(schema.ratings.orderId, orderIds), eq(schema.ratings.raterType, "CUSTOMER")),
  });
  if (customerRatings.length === 0) return;

  const avg = customerRatings.reduce((sum, r) => sum + r.value, 0) / customerRatings.length;
  await db
    .update(schema.drivers)
    .set({ ratingAvg: Math.round(avg * 100) / 100 })
    .where(eq(schema.drivers.id, driverId));
}

export async function submitRating(input: {
  orderId: string;
  actorUserId: string;
  raterType: "CUSTOMER" | "DRIVER";
  value: number;
  comment?: string;
  actorCustomerProfileId?: string;
  actorDriverId?: string;
}) {
  if (!Number.isInteger(input.value) || input.value < 1 || input.value > 5) {
    throw new ValidationError("value must be an integer from 1 to 5");
  }

  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, input.orderId) });
  if (!order) throw new NotFoundError("Order", input.orderId);
  if (order.status !== "DELIVERED") {
    throw new ValidationError(`Order must be DELIVERED to rate it, got ${order.status}`);
  }

  const accepted = await getAcceptedOfferForOrder(db, input.orderId);

  if (input.raterType === "CUSTOMER") {
    if (order.customerProfileId !== input.actorCustomerProfileId) {
      throw new ForbiddenError("You do not have access to this order");
    }
  } else {
    if (!accepted || accepted.driverId !== input.actorDriverId) {
      throw new ForbiddenError("You were not the assigned driver for this order");
    }
  }

  const existing = await db.query.ratings.findFirst({
    where: and(eq(schema.ratings.orderId, input.orderId), eq(schema.ratings.raterType, input.raterType)),
  });
  if (existing) throw new ConflictError("This order has already been rated by this party");

  const [rating] = await db
    .insert(schema.ratings)
    .values({ orderId: input.orderId, raterType: input.raterType, value: input.value, comment: input.comment })
    .returning();

  // A customer rating the driver is what actually moves the driver's public
  // rating; a driver rating the customer is recorded for trust/support
  // purposes but doesn't (yet) feed a customer-facing score.
  if (input.raterType === "CUSTOMER" && accepted) {
    await recomputeDriverRatingAvg(accepted.driverId);
  }

  return rating;
}

export async function listRatingsForOrder(orderId: string) {
  return db.query.ratings.findMany({ where: eq(schema.ratings.orderId, orderId) });
}
