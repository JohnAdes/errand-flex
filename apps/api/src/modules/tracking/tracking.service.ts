import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { ForbiddenError, NotFoundError } from "../../lib/errors";
import { getAcceptedOfferForOrder } from "../dispatch/dispatch.service";

/**
 * Closes the "where is it currently located" chain-of-custody gap:
 * `location_events` existed in the schema but nothing ever wrote to it or
 * read it back. A real mobile driver app would background-post pings every
 * N seconds/meters; this endpoint is what it would call.
 */
export async function recordDriverLocation(driverId: string, lat: number, lng: number, orderId?: string) {
  if (orderId) {
    // Object-level check: a driver can only tag a ping with an order they're
    // actually the accepted carrier for (same pattern as orders.service.ts's
    // getOrder ownership check).
    const accepted = await getAcceptedOfferForOrder(db, orderId);
    if (!accepted || accepted.driverId !== driverId) {
      throw new ForbiddenError("You are not the assigned driver for this order");
    }
  }

  const [event] = await db
    .insert(schema.locationEvents)
    .values({ driverId, orderId: orderId ?? null, lat, lng })
    .returning();
  return event;
}

const TRACKABLE_STATUSES = [
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE_TO_PICKUP",
  "DRIVER_ARRIVED_AT_PICKUP",
  "PICKUP_VERIFICATION_IN_PROGRESS",
  "PICKED_UP",
  "IN_TRANSIT",
  "ARRIVED_AT_DESTINATION",
  "DELIVERY_VERIFICATION_IN_PROGRESS",
];

/**
 * Live position for one order: the driver's most recent ping, whether it was
 * tagged with this specific order or logged generically while this order was
 * their active delivery. Only exposed while the order is actually in transit
 * — before pickup or after delivery, "current location" isn't a meaningful
 * or appropriate thing to expose.
 */
export async function getOrderTracking(orderId: string, requesterCustomerProfileId?: string) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order", orderId);
  if (requesterCustomerProfileId && order.customerProfileId !== requesterCustomerProfileId) {
    throw new ForbiddenError("You do not have access to this order");
  }

  if (!TRACKABLE_STATUSES.includes(order.status)) {
    return { trackable: false, status: order.status, driverId: null, lastLocation: null };
  }

  const accepted = await getAcceptedOfferForOrder(db, orderId);
  if (!accepted) return { trackable: false, status: order.status, driverId: null, lastLocation: null };

  const orderTagged = await db.query.locationEvents.findFirst({
    where: and(eq(schema.locationEvents.driverId, accepted.driverId), eq(schema.locationEvents.orderId, orderId)),
    orderBy: (events, { desc }) => [desc(events.recordedAt)],
  });
  const anyRecent =
    orderTagged ??
    (await db.query.locationEvents.findFirst({
      where: eq(schema.locationEvents.driverId, accepted.driverId),
      orderBy: (events, { desc }) => [desc(events.recordedAt)],
    }));

  return {
    trackable: true,
    status: order.status,
    driverId: accepted.driverId,
    lastLocation: anyRecent ? { lat: anyRecent.lat, lng: anyRecent.lng, recordedAt: anyRecent.recordedAt } : null,
  };
}
