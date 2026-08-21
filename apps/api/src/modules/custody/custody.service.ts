import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../db";
import { NotFoundError, ValidationError, ForbiddenError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { OrderStatus } from "@courier/shared-types";
import { transitionOrder, transitionOrderThrough } from "../orders/orders.service";
import { getAcceptedOfferForOrder } from "../dispatch/dispatch.service";
import { capturePaymentForOrder } from "../payments/payments.service";

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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

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
    await transitionOrderThrough(order.id, OrderStatus.PICKUP_VERIFICATION_IN_PROGRESS, `driver:${input.driverId}`, {});

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

    await tx.update(schema.orders).set({ status: "PICKED_UP" }).where(eq(schema.orders.id, order.id));

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
    await transitionOrderThrough(order.id, OrderStatus.DELIVERY_VERIFICATION_IN_PROGRESS, `driver:${input.driverId}`, {});

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

    const finalStatus = input.outcome === "DELIVERED" ? "DELIVERED" : "DELIVERY_FAILED";
    await tx.update(schema.orders).set({ status: finalStatus }).where(eq(schema.orders.id, order.id));

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
        await tx.insert(schema.driverEarnings).values({
          driverId: acceptedOffer.driverId,
          orderId: order.id,
          amountCents: acceptedOffer.payoutCents,
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
