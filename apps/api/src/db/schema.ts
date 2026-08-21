// Courier Marketplace — core data model (Drizzle ORM).
//
// Switched from Prisma to Drizzle for this starter kit: Prisma's CLI needs to
// download native query/schema-engine binaries from binaries.prisma.sh on
// first `generate`/`migrate`, which fails in network-restricted environments
// (this one included). Drizzle + node-postgres (`pg`) is pure JS/TS end to
// end — `npm install` is the only thing that needs network access, and
// everything after that (migrate, seed, query) works fully offline against
// whatever Postgres you point it at. Functionally this schema is a straight
// port of the architecture doc's data model (02-architecture.md §5).
//
// GEOSPATIAL NOTE: geo points are plain lat/lng `real` columns, not PostGIS
// geography — see the note in docker-compose.yml for the upgrade path.

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  real,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------- Enums ----------

export const userRoleEnum = pgEnum("user_role", [
  "CUSTOMER",
  "DRIVER",
  "DISPATCHER",
  "OPS_MANAGER",
  "FINANCE",
  "SUPER_ADMIN",
]);
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "SUSPENDED", "DELETED"]);
export const driverStatusEnum = pgEnum("driver_status", ["PENDING", "APPROVED", "SUSPENDED", "DEACTIVATED"]);
export const vehicleTypeEnum = pgEnum("vehicle_type", ["SEDAN", "VAN"]);
export const serviceLevelEnum = pgEnum("service_level", ["ECONOMY", "STANDARD", "PRIORITY", "SCHEDULED"]);
export const packageCategoryEnum = pgEnum("package_category", [
  "DOCUMENTS",
  "SMALL_PARCEL",
  "MEDIUM_PARCEL",
  "LARGE_PARCEL",
  "FOOD",
  "ELECTRONICS",
  "OTHER",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "DRAFT",
  "QUOTE_GENERATED",
  "AWAITING_PAYMENT",
  "SCHEDULED",
  "SEARCHING_FOR_DRIVER",
  "DRIVER_OFFERED",
  "DRIVER_ASSIGNED",
  "DRIVER_EN_ROUTE_TO_PICKUP",
  "DRIVER_ARRIVED_AT_PICKUP",
  "PICKUP_VERIFICATION_IN_PROGRESS",
  "PICKED_UP",
  "IN_TRANSIT",
  "ARRIVED_AT_DESTINATION",
  "DELIVERY_VERIFICATION_IN_PROGRESS",
  "DELIVERED",
  "DELIVERY_FAILED",
  "RETURN_REQUESTED",
  "RETURNING_TO_SENDER",
  "RETURNED",
  "CANCELED",
  "DISPUTED",
  "REFUNDED",
]);
export const stopTypeEnum = pgEnum("stop_type", ["PICKUP", "DROPOFF"]);
export const driverOfferStatusEnum = pgEnum("driver_offer_status", ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "REQUIRES_CAPTURE",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);
export const marketStatusEnum = pgEnum("market_status", ["PLANNED", "ACTIVE", "PAUSED"]);

// ---------- Identity ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 32 }).unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull(),
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  emailVerified: boolean("email_verified").notNull().default(false),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// A business account groups multiple customer_profiles (e.g. a retailer's
// staff accounts) under one entity so volume-based pricing can be evaluated
// across the whole business rather than per individual sender — closes the
// "small business lacks affordable local logistics" / "business delivery
// volume" pricing gap. `discountTiers` is evaluated by the
// BUSINESS_VOLUME_DISCOUNT pricing rule (see pricing.service.ts) against a
// live count of that business's orders in the current calendar month.
export const businessAccounts = pgTable("business_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  contactEmail: varchar("contact_email", { length: 255 }),
  discountTiers: jsonb("discount_tiers").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const customerProfiles = pgTable("customer_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  accountType: varchar("account_type", { length: 32 }).notNull().default("PERSONAL"),
  businessAccountId: uuid("business_account_id").references(() => businessAccounts.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  department: varchar("department", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Drivers ----------

export const drivers = pgTable(
  "drivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().unique().references(() => users.id),
    status: driverStatusEnum("status").notNull().default("PENDING"),
    ratingAvg: real("rating_avg").notNull().default(5.0),
    activeOrderCount: integer("active_order_count").notNull().default(0),
    currentZoneId: uuid("current_zone_id"),
    onlineStatus: boolean("online_status").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("drivers_status_idx").on(t.status),
    onlineIdx: index("drivers_online_idx").on(t.onlineStatus),
  })
);

export const driverVerificationRecords = pgTable("driver_verification_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  checkType: varchar("check_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  verifiedAt: timestamp("verified_at"),
  expiresAt: timestamp("expires_at"),
  providerRef: varchar("provider_ref", { length: 255 }),
});

export const driverDocuments = pgTable("driver_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  docType: varchar("doc_type", { length: 32 }).notNull(),
  fileRef: text("file_ref").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("PENDING"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  type: vehicleTypeEnum("type").notNull(),
  plate: varchar("plate", { length: 32 }).notNull(),
  capacityWeightKg: real("capacity_weight_kg").notNull(),
  capacityVolumeL: real("capacity_volume_l").notNull(),
  insuranceDocId: uuid("insurance_doc_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Geography ----------

export const serviceAreas = pgTable("service_areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).notNull(),
  marketStatus: marketStatusEnum("market_status").notNull().default("PLANNED"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceAreaId: uuid("service_area_id").notNull().references(() => serviceAreas.id),
  name: varchar("name", { length: 255 }).notNull(),
  boundsNorth: real("bounds_north").notNull(),
  boundsSouth: real("bounds_south").notNull(),
  boundsEast: real("bounds_east").notNull(),
  boundsWest: real("bounds_west").notNull(),
  operatingHours: jsonb("operating_hours"),
  blackoutPeriods: jsonb("blackout_periods"),
});

export const addresses = pgTable("addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerProfileId: uuid("customer_profile_id").references(() => customerProfiles.id),
  line1: varchar("line1", { length: 255 }).notNull(),
  line2: varchar("line2", { length: 255 }),
  city: varchar("city", { length: 120 }).notNull(),
  state: varchar("state", { length: 60 }).notNull(),
  postal: varchar("postal", { length: 20 }).notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  label: varchar("label", { length: 60 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Orders ----------

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerProfileId: uuid("customer_profile_id").notNull().references(() => customerProfiles.id),
    status: orderStatusEnum("status").notNull().default("DRAFT"),
    serviceLevel: serviceLevelEnum("service_level").notNull(),
    quoteId: uuid("quote_id").unique(),
    pricingRuleVersionId: uuid("pricing_rule_version_id"),
    totalCents: integer("total_cents"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    deliveryInstructions: text("delivery_instructions"),
    contactlessDelivery: boolean("contactless_delivery").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("orders_status_idx").on(t.status),
    customerIdx: index("orders_customer_idx").on(t.customerProfileId),
    createdIdx: index("orders_created_idx").on(t.createdAt),
  })
);

export const packages = pgTable("packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  category: packageCategoryEnum("category").notNull(),
  weightKg: real("weight_kg").notNull(),
  lengthCm: real("length_cm"),
  widthCm: real("width_cm"),
  heightCm: real("height_cm"),
  quantity: integer("quantity").notNull().default(1),
  declaredValueCents: integer("declared_value_cents").notNull().default(0),
  fragile: boolean("fragile").notNull().default(false),
  perishable: boolean("perishable").notNull().default(false),
  confidential: boolean("confidential").notNull().default(false),
  photoRefs: text("photo_refs").array().notNull().default([]),
});

export const stops = pgTable(
  "stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    type: stopTypeEnum("type").notNull(),
    addressId: uuid("address_id").notNull().references(() => addresses.id),
    sequenceNo: integer("sequence_no").notNull(),
    recipientName: varchar("recipient_name", { length: 255 }),
    recipientPhone: varchar("recipient_phone", { length: 32 }),
    timeWindowStart: timestamp("time_window_start"),
    timeWindowEnd: timestamp("time_window_end"),
  },
  (t) => ({ orderIdx: index("stops_order_idx").on(t.orderId) })
);

// ---------- Dispatch & Routing ----------

export const routeBatches = pgTable("route_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").references(() => drivers.id),
  status: varchar("status", { length: 32 }).notNull().default("SUGGESTED"),
  createdBy: varchar("created_by", { length: 32 }).notNull().default("SYSTEM"),
  groupingReason: jsonb("grouping_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const routeAssignments = pgTable("route_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  routeBatchId: uuid("route_batch_id").notNull().references(() => routeBatches.id),
  stopId: uuid("stop_id").notNull().unique().references(() => stops.id),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id),
  sequenceNo: integer("sequence_no").notNull(),
  eta: timestamp("eta"),
});

export const driverOffers = pgTable(
  "driver_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").references(() => orders.id),
    routeBatchId: uuid("route_batch_id").references(() => routeBatches.id),
    driverId: uuid("driver_id").notNull().references(() => drivers.id),
    status: driverOfferStatusEnum("status").notNull().default("PENDING"),
    payoutCents: integer("payout_cents").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    orderStatusIdx: index("driver_offers_order_status_idx").on(t.orderId, t.status),
    driverStatusIdx: index("driver_offers_driver_status_idx").on(t.driverId, t.status),
  })
);

export const locationEvents = pgTable(
  "location_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id").notNull().references(() => drivers.id),
    orderId: uuid("order_id"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => ({ driverTimeIdx: index("location_events_driver_time_idx").on(t.driverId, t.recordedAt) })
);

// ---------- Chain of Custody ----------

export const chainOfCustodyEvents = pgTable(
  "chain_of_custody_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id").references(() => packages.id),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    actorDriverId: uuid("actor_driver_id").notNull().references(() => drivers.id),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    geoLat: real("geo_lat").notNull(),
    geoLng: real("geo_lng").notNull(),
    deviceId: varchar("device_id", { length: 255 }),
  },
  (t) => ({
    orderIdx: index("custody_order_idx").on(t.orderId),
    packageIdx: index("custody_package_idx").on(t.packageId),
  })
);

export const pickupVerifications = pgTable("pickup_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id),
  driverSelfieRef: text("driver_selfie_ref").notNull(),
  packagePhotoRefs: text("package_photo_refs").array().notNull().default([]),
  senderName: varchar("sender_name", { length: 255 }).notNull(),
  senderSignatureRef: text("sender_signature_ref"),
  pinUsed: boolean("pin_used").notNull().default(false),
  gpsRadiusPass: boolean("gps_radius_pass").notNull(),
  verifiedAt: timestamp("verified_at").notNull().defaultNow(),
});

export const deliveryVerifications = pgTable("delivery_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id),
  podPhotoRef: text("pod_photo_ref"),
  recipientName: varchar("recipient_name", { length: 255 }).notNull(),
  recipientSignatureRef: text("recipient_signature_ref"),
  pinUsed: boolean("pin_used").notNull().default(false),
  idVerified: boolean("id_verified").notNull().default(false),
  gpsRadiusPass: boolean("gps_radius_pass").notNull(),
  outcome: varchar("outcome", { length: 16 }).notNull(),
  failureReason: text("failure_reason"),
  verifiedAt: timestamp("verified_at").notNull().defaultNow(),
});

// ---------- Pricing ----------

export const pricingPlans = pgTable("pricing_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  scope: jsonb("scope").notNull().default({}),
  active: boolean("active").notNull().default(true),
});

export const pricingRules = pgTable("pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  pricingPlanId: uuid("pricing_plan_id").notNull().references(() => pricingPlans.id),
  ruleType: varchar("rule_type", { length: 64 }).notNull(),
  params: jsonb("params").notNull(),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pricingRuleVersions = pgTable(
  "pricing_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pricingPlanId: uuid("pricing_plan_id").notNull().references(() => pricingPlans.id),
    versionNo: integer("version_no").notNull(),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
    publishedBy: varchar("published_by", { length: 255 }),
    snapshot: jsonb("snapshot").notNull(),
  },
  (t) => ({ planVersionUnique: uniqueIndex("pricing_plan_version_unique").on(t.pricingPlanId, t.versionNo) })
);

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  breakdown: jsonb("breakdown").notNull(),
  totalCents: integer("total_cents").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  expiresAt: timestamp("expires_at").notNull(),
  pricingRuleVersionId: uuid("pricing_rule_version_id").notNull().references(() => pricingRuleVersions.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Payments ----------

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().unique().references(() => orders.id),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  amountCents: integer("amount_cents").notNull(),
  status: paymentStatusEnum("status").notNull().default("REQUIRES_CAPTURE"),
  capturedAt: timestamp("captured_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  issuedBy: varchar("issued_by", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const driverEarnings = pgTable(
  "driver_earnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id").notNull().references(() => drivers.id),
    orderId: uuid("order_id"),
    amountCents: integer("amount_cents").notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("PENDING"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ driverStatusIdx: index("driver_earnings_driver_status_idx").on(t.driverId, t.status) })
);

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  driverId: uuid("driver_id").notNull().references(() => drivers.id),
  amountCents: integer("amount_cents").notNull(),
  stripeTransferId: varchar("stripe_transfer_id", { length: 255 }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("PENDING"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Trust & Support ----------

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    raterType: varchar("rater_type", { length: 16 }).notNull(),
    value: integer("value").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ orderRaterUnique: uniqueIndex("ratings_order_rater_unique").on(t.orderId, t.raterType) })
);

export const claimsDisputes = pgTable("claims_disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  reportedByUserId: uuid("reported_by_user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 32 }).notNull(),
  description: text("description").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("OPEN"),
  evidenceRefs: text("evidence_refs").array().notNull().default([]),
  resolution: text("resolution"),
  resolvedBy: varchar("resolved_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Audit ----------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("audit_entity_idx").on(t.entityType, t.entityId),
    occurredIdx: index("audit_occurred_idx").on(t.occurredAt),
  })
);

// ---------- Relations (for query API convenience) ----------

export const usersRelations = relations(users, ({ one }) => ({
  customerProfile: one(customerProfiles, { fields: [users.id], references: [customerProfiles.userId] }),
  driver: one(drivers, { fields: [users.id], references: [drivers.userId] }),
}));

export const businessAccountsRelations = relations(businessAccounts, ({ many }) => ({
  members: many(customerProfiles),
}));

export const customerProfilesRelations = relations(customerProfiles, ({ one }) => ({
  businessAccount: one(businessAccounts, { fields: [customerProfiles.businessAccountId], references: [businessAccounts.id] }),
}));

export const ordersRelations = relations(orders, ({ many, one }) => ({
  packages: many(packages),
  stops: many(stops),
  quote: one(quotes, { fields: [orders.quoteId], references: [quotes.id] }),
  pickupVerification: one(pickupVerifications, { fields: [orders.id], references: [pickupVerifications.orderId] }),
  deliveryVerification: one(deliveryVerifications, { fields: [orders.id], references: [deliveryVerifications.orderId] }),
  payment: one(payments, { fields: [orders.id], references: [payments.orderId] }),
  routeAssignment: one(routeAssignments, { fields: [orders.id], references: [routeAssignments.orderId] }),
}));

export const stopsRelations = relations(stops, ({ one }) => ({
  order: one(orders, { fields: [stops.orderId], references: [orders.id] }),
  address: one(addresses, { fields: [stops.addressId], references: [addresses.id] }),
}));

export const routeBatchesRelations = relations(routeBatches, ({ many, one }) => ({
  assignments: many(routeAssignments),
  driver: one(drivers, { fields: [routeBatches.driverId], references: [drivers.id] }),
  offers: many(driverOffers),
}));

export const routeAssignmentsRelations = relations(routeAssignments, ({ one }) => ({
  routeBatch: one(routeBatches, { fields: [routeAssignments.routeBatchId], references: [routeBatches.id] }),
  order: one(orders, { fields: [routeAssignments.orderId], references: [orders.id] }),
  stop: one(stops, { fields: [routeAssignments.stopId], references: [stops.id] }),
}));

export const driverOffersRelations = relations(driverOffers, ({ one }) => ({
  order: one(orders, { fields: [driverOffers.orderId], references: [orders.id] }),
  routeBatch: one(routeBatches, { fields: [driverOffers.routeBatchId], references: [routeBatches.id] }),
  driver: one(drivers, { fields: [driverOffers.driverId], references: [drivers.id] }),
}));

// NOTE ON THIS FIX: Drizzle's relational query API (`db.query.x.findFirst({ with: ... })`)
// needs BOTH sides of a relation declared to reliably infer the join, even when
// the FK direction is unambiguous. `ordersRelations` declaring `packages: many(packages)`
// with no matching `packagesRelations` declaring the reverse `one(orders, ...)` threw
// "There is not enough information to infer relation" at runtime — a real bug caught by
// actually running the pickup-verification flow end to end (see the write-up sent to the
// user), not something a schema-only review would have caught. Every table below that's
// referenced via `many()` from another table's relations now has its reverse declared.
export const packagesRelations = relations(packages, ({ one, many }) => ({
  order: one(orders, { fields: [packages.orderId], references: [orders.id] }),
  custodyEvents: many(chainOfCustodyEvents),
}));

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  driver: one(drivers, { fields: [vehicles.driverId], references: [drivers.id] }),
}));

export const driverDocumentsRelations = relations(driverDocuments, ({ one }) => ({
  driver: one(drivers, { fields: [driverDocuments.driverId], references: [drivers.id] }),
}));

export const driversRelations = relations(drivers, ({ many, one }) => ({
  vehicles: many(vehicles),
  documents: many(driverDocuments),
  user: one(users, { fields: [drivers.userId], references: [users.id] }),
}));

export const pickupVerificationsRelations = relations(pickupVerifications, ({ one }) => ({
  order: one(orders, { fields: [pickupVerifications.orderId], references: [orders.id] }),
}));

export const deliveryVerificationsRelations = relations(deliveryVerifications, ({ one }) => ({
  order: one(orders, { fields: [deliveryVerifications.orderId], references: [orders.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  refunds: many(refunds),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
  payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }),
}));

export const quotesRelations = relations(quotes, ({ many }) => ({
  orders: many(orders),
}));

export const chainOfCustodyEventsRelations = relations(chainOfCustodyEvents, ({ one }) => ({
  order: one(orders, { fields: [chainOfCustodyEvents.orderId], references: [orders.id] }),
  package: one(packages, { fields: [chainOfCustodyEvents.packageId], references: [packages.id] }),
  driver: one(drivers, { fields: [chainOfCustodyEvents.actorDriverId], references: [drivers.id] }),
}));
