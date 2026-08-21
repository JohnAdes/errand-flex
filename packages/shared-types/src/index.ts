// Shared types/enums used by both the API and the admin portal.
// Keep this in sync with apps/api/src/db/schema.ts pgEnum definitions.
//
// Uses the "as const object + derived union type" pattern instead of TS
// `enum` — this way a plain string literal ("CUSTOMER", "DELIVERED", etc.,
// e.g. from a Zod-validated request body or a route handler) is directly
// assignable to the type without a cast, which real `enum` types don't allow.

export const OrderStatus = {
  DRAFT: "DRAFT",
  QUOTE_GENERATED: "QUOTE_GENERATED",
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  SCHEDULED: "SCHEDULED",
  SEARCHING_FOR_DRIVER: "SEARCHING_FOR_DRIVER",
  DRIVER_OFFERED: "DRIVER_OFFERED",
  DRIVER_ASSIGNED: "DRIVER_ASSIGNED",
  DRIVER_EN_ROUTE_TO_PICKUP: "DRIVER_EN_ROUTE_TO_PICKUP",
  DRIVER_ARRIVED_AT_PICKUP: "DRIVER_ARRIVED_AT_PICKUP",
  PICKUP_VERIFICATION_IN_PROGRESS: "PICKUP_VERIFICATION_IN_PROGRESS",
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  ARRIVED_AT_DESTINATION: "ARRIVED_AT_DESTINATION",
  DELIVERY_VERIFICATION_IN_PROGRESS: "DELIVERY_VERIFICATION_IN_PROGRESS",
  DELIVERED: "DELIVERED",
  DELIVERY_FAILED: "DELIVERY_FAILED",
  RETURN_REQUESTED: "RETURN_REQUESTED",
  RETURNING_TO_SENDER: "RETURNING_TO_SENDER",
  RETURNED: "RETURNED",
  CANCELED: "CANCELED",
  DISPUTED: "DISPUTED",
  REFUNDED: "REFUNDED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

// Valid forward transitions. Enforced server-side in orders.service.ts —
// this map is exported so the admin UI can render valid next-actions without
// duplicating the rule (still re-validated on the server on every call).
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: [OrderStatus.QUOTE_GENERATED, OrderStatus.CANCELED],
  QUOTE_GENERATED: [OrderStatus.AWAITING_PAYMENT, OrderStatus.CANCELED],
  AWAITING_PAYMENT: [OrderStatus.SCHEDULED, OrderStatus.CANCELED],
  SCHEDULED: [OrderStatus.SEARCHING_FOR_DRIVER, OrderStatus.CANCELED],
  SEARCHING_FOR_DRIVER: [OrderStatus.DRIVER_OFFERED, OrderStatus.CANCELED],
  DRIVER_OFFERED: [OrderStatus.DRIVER_ASSIGNED, OrderStatus.SEARCHING_FOR_DRIVER],
  DRIVER_ASSIGNED: [OrderStatus.DRIVER_EN_ROUTE_TO_PICKUP],
  DRIVER_EN_ROUTE_TO_PICKUP: [OrderStatus.DRIVER_ARRIVED_AT_PICKUP],
  DRIVER_ARRIVED_AT_PICKUP: [OrderStatus.PICKUP_VERIFICATION_IN_PROGRESS],
  PICKUP_VERIFICATION_IN_PROGRESS: [OrderStatus.PICKED_UP],
  PICKED_UP: [OrderStatus.IN_TRANSIT],
  IN_TRANSIT: [OrderStatus.ARRIVED_AT_DESTINATION],
  ARRIVED_AT_DESTINATION: [OrderStatus.DELIVERY_VERIFICATION_IN_PROGRESS],
  DELIVERY_VERIFICATION_IN_PROGRESS: [OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED],
  DELIVERY_FAILED: [OrderStatus.RETURN_REQUESTED, OrderStatus.SEARCHING_FOR_DRIVER],
  RETURN_REQUESTED: [OrderStatus.RETURNING_TO_SENDER],
  RETURNING_TO_SENDER: [OrderStatus.RETURNED],
  DELIVERED: [OrderStatus.DISPUTED],
  DISPUTED: [OrderStatus.REFUNDED],
  RETURNED: [],
  CANCELED: [],
  REFUNDED: [],
};

export const ServiceLevel = {
  ECONOMY: "ECONOMY",
  STANDARD: "STANDARD",
  PRIORITY: "PRIORITY",
  SCHEDULED: "SCHEDULED",
} as const;
export type ServiceLevel = (typeof ServiceLevel)[keyof typeof ServiceLevel];

export const PackageCategory = {
  DOCUMENTS: "DOCUMENTS",
  SMALL_PARCEL: "SMALL_PARCEL",
  MEDIUM_PARCEL: "MEDIUM_PARCEL",
  LARGE_PARCEL: "LARGE_PARCEL",
  FOOD: "FOOD",
  ELECTRONICS: "ELECTRONICS",
  OTHER: "OTHER",
} as const;
export type PackageCategory = (typeof PackageCategory)[keyof typeof PackageCategory];

export const DriverStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  SUSPENDED: "SUSPENDED",
  DEACTIVATED: "DEACTIVATED",
} as const;
export type DriverStatus = (typeof DriverStatus)[keyof typeof DriverStatus];

export const VehicleType = {
  SEDAN: "SEDAN",
  VAN: "VAN",
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

export const DriverOfferStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  EXPIRED: "EXPIRED",
} as const;
export type DriverOfferStatus = (typeof DriverOfferStatus)[keyof typeof DriverOfferStatus];

export const UserRole = {
  CUSTOMER: "CUSTOMER",
  DRIVER: "DRIVER",
  DISPATCHER: "DISPATCHER",
  OPS_MANAGER: "OPS_MANAGER",
  FINANCE: "FINANCE",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export interface PriceBreakdownLine {
  label: string;
  amountCents: number;
}

export interface QuoteResult {
  totalCents: number;
  currency: string;
  breakdown: PriceBreakdownLine[];
  pricingRuleVersionId: string;
  expiresAt: string;
}
