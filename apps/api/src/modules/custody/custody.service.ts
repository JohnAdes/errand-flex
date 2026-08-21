import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../db";
import { NotFoundError, ValidationError, ForbiddenError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { OrderStatus } from "@courier/shared-types";
import { transitionOrder, transitionOrderThrough } from "../orders/orders.service";
import { getAcceptedOfferForOrder } from "../dispatch/dispatch.service";
import { capturePaymentForOrder } from "../payments/payments.service";
import { haversineMeters } from "../../lib/geo";

/**
 * Object-level authorization: verifying pickup/delivery is a chain-of-custody
 * action, so only the driver actually assigned to this order (via an
 * ACCEPTED offer, single or batch) may perform it — found missing by a code
 * review pass: any authenticated driver could previously verify any order,
 * falsifying custody records and corrupting the wrong driver's capacity
 * counter. Mirrors the same check claims.service.ts already does.
 */
async function assertDriverAssignedToOrder(orderId: string, driverId: string) {
  const accepted = await getAcceptedOfferForOrder(db, orderId);
  if (!accepted || accepted.driverId !== driverId) {
    throw new ForbiddenError("You are not the assigned driver for this order");
  }
}

const DEFAULT_GPS_RADIUS_METERS = 150;

/**
 * Media upload note: `driverSelfieRef` / `packagePhotoRefs` / `podPhotoRef`
 * below are expected to be storage paths (e.g. Firebase Cloud Storage object
 * paths) obtained from a separate signed-upload-URL flow, per
 * 02-architecture.md §1 and §11. That upload flow isn't implemented in this
 * starter kit (needs a real Firebase/GCS project) — for local development,
 * pass any string as the ref (e.g. a local file path or placeholder) and
 * treat the verification logic below, which IS fully implemented, as the
 * part that matters. Do not ship this to production accepting arbitrary
 * client-supplied storage refs without validating they were actually issued
 * by your signed-upload flow.
 */

interface PickupVerifyInput {
  orderId: string;
  driverId: string;
  driverLat: number;
  driverLng: number;
  pickupLat: number;
  pickupLng: number;
  driverSelfieRef: string;
  packagePhotoRefs: string[];
  senderName: string;
  senderSignatureRef?: string;
  pinUsed: boolean;
  deviceId?: string;
}

export async function verifyPickup(input: PickupVerifyInput) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, input.orderId),
    with: { packages: true },
  });
  if (!order) throw new NotFoundError("Order", input.orderId);
  await assertDriverAssignedToOrder(order.id, input.driverId);

  const distanceMeters = haversineMeters(input.driverLat, input.driverLng, input.pickupLat, input.pickupLng);
  const gpsRadiusPass = distanceMeters <= DEFAULT_GPS_RADIUS_METERS;

  if (!gpsRadiusPass) {
    throw new ValidationError(
      `You're ${Math.round(distanceMeters)}m from the pickup location — get within ${DEFAULT_GPS_RADIUS_METERS}m to confirm pickup`
    );
  }
  if (!input.driverSelfieRef) {
    throw new ValidationError("A live driver selfie is required to confirm pickup");
  }
  if (input.packagePhotoRefs.length === 0) {
    throw new ValidationError("At least one package photo is required to confirm pickup");
  }
  if (!input.senderName) {
    throw new ValidationError("Sender name is required to confirm pickup");
  }

  return db.transaction(async (tx) => {
    await transitionOrderThrough(order.id, OrderStatus.PICKUP_VERIFICATION_IN_PROGRESS, `driver:${input.driverId}`, {}, tx);

    const [verification] = await tx
      .insert(schema.pickupVerifications)
      .values({
        orderId: order.id,
        driverSelfieRef: input.driverSelfieRef,
        packagePhotoRefs: input.packagePhotoRefs,
        senderName: input.senderName,
        senderSignatureRef: input.senderSignatureRef,
        pinUsed: input.pinUsed,
        gpsRadiusPass,
      })
      .returning();

    for (const pkg of order.packages) {
      await tx.insert(schema.chainOfCustodyEvents).values({
        packageId: pkg.id,
        orderId: order.id,
        eventType: "PICKUP_VERIFIED",
        actorDriverId: input.driverId,
        geoLat: input.driverLat,
        geoLng: input.driverLng,
        deviceId: input.deviceId,
      });
    }

    await recordAudit(tx, {
      actorId: null,
      action: "PICKUP_VERIFIED",
      entityType: "Order",
      entityId: order.id,
      after: { driverId: input.driverId },
    });

    // Final status write goes through transitionOrder (not a direct update)
    // — found by review: the previous direct `tx.update` bypassed the ONLY
    // function allowed to change order status, so this transition skipped
    // ORDER_STATUS_TRANSITIONS validation and wrote no ORDER_STATUS_* audit
    // entry, unlike every other status change in the system.
    await transitionOrder(order.id, OrderStatus.PICKED_UP, `driver:${input.driverId}`, {}, tx);

    return verification;
  });
}

interface DeliveryVerifyInput {
  orderId: string;
  driverId: string;
  driverLat: number;
  driverLng: number;
  dropoffLat: number;
  dropoffLng: number;
  outcome: "DELIVERED" | "FAILED";
  podPhotoRef?: string;
  recipientName?: string;
  recipientSignatureRef?: string;
  pinUsed?: boolean;
  idVerified?: boolean;
  contactless: boolean;
  failureReason?: string;
}

export async function verifyDelivery(input: DeliveryVerifyInput) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, input.orderId),
    with: { packages: true },
  });
  if (!order) throw new NotFoundError("Order", input.orderId);
  await assertDriverAssignedToOrder(order.id, input.driverId);

  const distanceMeters = haversineMeters(input.driverLat, input.driverLng, input.dropoffLat, input.dropoffLng);
  const gpsRadiusPass = distanceMeters <= DEFAULT_GPS_RADIUS_METERS;

  if (!gpsRadiusPass) {
    throw new ValidationError(
      `You're ${Math.round(distanceMeters)}m from the delivery location — get within ${DEFAULT_GPS_RADIUS_METERS}m to confirm delivery`
    );
  }

  if (input.outcome === "DELIVERED") {
    if (!input.contactless && !input.podPhotoRef) {
      throw new ValidationError("A proof-of-delivery photo is required unless contactless delivery was selected");
    }
    if (!input.recipientName) {
      throw new ValidationError("Recipient name is required to confirm delivery");
    }
    if (!input.recipientSignatureRef && !input.pinUsed && !input.idVerified) {
      throw new ValidationError("At least one of signature, PIN, or ID verification is required");
    }
  } else if (input.outcome === "FAILED" && !input.failureReason) {
    throw new ValidationError("A reason is required to record a failed delivery attempt");
  }

  return db.transaction(async (tx) => {
    await transitionOrderThrough(
      order.id,
      OrderStatus.DELIVERY_VERIFICATION_IN_PROGRESS,
      `driver:${input.driverId}`,
      {},
      tx
    );

    const [verification] = await tx
      .insert(schema.deliveryVerifications)
      .values({
        orderId: order.id,
        podPhotoRef: input.podPhotoRef,
        recipientName: input.recipientName ?? "N/A (failed attempt)",
        recipientSignatureRef: input.recipientSignatureRef,
        pinUsed: input.pinUsed ?? false,
        idVerified: input.idVerified ?? false,
        gpsRadiusPass,
        outcome: input.outcome,
        failureReason: input.failureReason,
      })
      .returning();

    for (const pkg of order.packages) {
      await tx.insert(schema.chainOfCustodyEvents).values({
        packageId: pkg.id,
        orderId: order.id,
        eventType: input.outcome === "DELIVERED" ? "DELIVERY_VERIFIED" : "FAILED",
        actorDriverId: input.driverId,
        geoLat: input.driverLat,
        geoLng: input.driverLng,
      });
    }

    // Final status write goes through transitionOrder (not a direct update)
    // — same fix as verifyPickup above: keeps this on the state machine's
    // validated path and its audit trail.
    const finalStatus = input.outcome === "DELIVERED" ? OrderStatus.DELIVERED : OrderStatus.DELIVERY_FAILED;
    await transitionOrder(order.id, finalStatus, `driver:${input.driverId}`, {}, tx);

    // Releases the driver's capacity slot regardless of outcome — a FAILED
    // delivery still ends the order's active life just as much as a
    // DELIVERED one. Previously this only ran inside the DELIVERED branch,
    // so a failed delivery leaked a permanently-held capacity slot; after 3
    // failed deliveries (any mix, any timeframe) a driver would be silently
    // excluded from every future offer round with no error anywhere.
    await tx
      .update(schema.drivers)
      .set({ activeOrderCount: sql`GREATEST(${schema.drivers.activeOrderCount} - 1, 0)` })
      .where(eq(schema.drivers.id, input.driverId));

    if (input.outcome === "DELIVERED") {
      // Closes the loop the README used to flag as a gap: capture the
      // authorized payment (net of any discounts/refunds — see
      // batching.service.ts's grouped-route discount) and credit the
      // driver's earnings ledger for this delivery.
      await capturePaymentForOrder(tx, order.id);
      const acceptedOffer = await getAcceptedOfferForOrder(tx, order.id);
      if (acceptedOffer) {
        // A batch offer's payoutCents is one flat amount for the WHOLE
        // batch (see dispatch.service.ts's createBatchOfferRound), but this
        // runs once per order as each one is individually delivered — found
        // by review to previously credit the full batch payout on every
        // order, tripling+ the driver's actual earnings on a multi-order
        // batch. Split it evenly across the batch's orders; a remainder of
        // up to (orderCount - 1) cents from the division is left
        // undistributed rather than building a more precise per-order
        // ledger, which is out of scope for this fix.
        let amountCents = acceptedOffer.payoutCents;
        if (acceptedOffer.routeBatchId) {
          const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.routeAssignments)
            .where(eq(schema.routeAssignments.routeBatchId, acceptedOffer.routeBatchId));
          amountCents = Math.floor(acceptedOffer.payoutCents / Math.max(count, 1));
        }
        await tx.insert(schema.driverEarnings).values({
          driverId: acceptedOffer.driverId,
          orderId: order.id,
          amountCents,
          type: "DELIVERY_PAYOUT",
          status: "PENDING",
        });
      }
    }

    await recordAudit(tx, {
      actorId: null,
      action: `DELIVERY_${input.outcome}`,
      entityType: "Order",
      entityId: order.id,
      after: { driverId: input.driverId },
    });

    return verification;
  });
}
