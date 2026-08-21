CREATE TYPE "public"."driver_offer_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('PENDING', 'APPROVED', 'SUSPENDED', 'DEACTIVATED');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('PLANNED', 'ACTIVE', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('DRAFT', 'QUOTE_GENERATED', 'AWAITING_PAYMENT', 'SCHEDULED', 'SEARCHING_FOR_DRIVER', 'DRIVER_OFFERED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_PICKUP', 'DRIVER_ARRIVED_AT_PICKUP', 'PICKUP_VERIFICATION_IN_PROGRESS', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'DELIVERY_VERIFICATION_IN_PROGRESS', 'DELIVERED', 'DELIVERY_FAILED', 'RETURN_REQUESTED', 'RETURNING_TO_SENDER', 'RETURNED', 'CANCELED', 'DISPUTED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."package_category" AS ENUM('DOCUMENTS', 'SMALL_PARCEL', 'MEDIUM_PARCEL', 'LARGE_PARCEL', 'FOOD', 'ELECTRONICS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('REQUIRES_CAPTURE', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."service_level" AS ENUM('ECONOMY', 'STANDARD', 'PRIORITY', 'SCHEDULED');--> statement-breakpoint
CREATE TYPE "public"."stop_type" AS ENUM('PICKUP', 'DROPOFF');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('CUSTOMER', 'DRIVER', 'DISPATCHER', 'OPS_MANAGER', 'FINANCE', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('SEDAN', 'VAN');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_profile_id" uuid,
	"line1" varchar(255) NOT NULL,
	"line2" varchar(255),
	"city" varchar(120) NOT NULL,
	"state" varchar(60) NOT NULL,
	"postal" varchar(20) NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"label" varchar(60),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"department" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_of_custody_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid,
	"order_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"actor_driver_id" uuid NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"geo_lat" real NOT NULL,
	"geo_lng" real NOT NULL,
	"device_id" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "claims_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"evidence_refs" text[] DEFAULT '{}' NOT NULL,
	"resolution" text,
	"resolved_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"account_type" varchar(32) DEFAULT 'PERSONAL' NOT NULL,
	"business_account_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"pod_photo_ref" text,
	"recipient_name" varchar(255) NOT NULL,
	"recipient_signature_ref" text,
	"pin_used" boolean DEFAULT false NOT NULL,
	"id_verified" boolean DEFAULT false NOT NULL,
	"gps_radius_pass" boolean NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"failure_reason" text,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_verifications_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"doc_type" varchar(32) NOT NULL,
	"file_ref" text NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"order_id" uuid,
	"amount_cents" integer NOT NULL,
	"type" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"route_batch_id" uuid,
	"driver_id" uuid NOT NULL,
	"status" "driver_offer_status" DEFAULT 'PENDING' NOT NULL,
	"payout_cents" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_verification_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"check_type" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"verified_at" timestamp,
	"expires_at" timestamp,
	"provider_ref" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "driver_status" DEFAULT 'PENDING' NOT NULL,
	"rating_avg" real DEFAULT 5 NOT NULL,
	"active_order_count" integer DEFAULT 0 NOT NULL,
	"current_zone_id" uuid,
	"online_status" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "location_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"order_id" uuid,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'DRAFT' NOT NULL,
	"service_level" "service_level" NOT NULL,
	"quote_id" uuid,
	"pricing_rule_version_id" uuid,
	"total_cents" integer,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"delivery_instructions" text,
	"contactless_delivery" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"category" "package_category" NOT NULL,
	"weight_kg" real NOT NULL,
	"length_cm" real,
	"width_cm" real,
	"height_cm" real,
	"quantity" integer DEFAULT 1 NOT NULL,
	"declared_value_cents" integer DEFAULT 0 NOT NULL,
	"fragile" boolean DEFAULT false NOT NULL,
	"perishable" boolean DEFAULT false NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"photo_refs" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"amount_cents" integer NOT NULL,
	"status" "payment_status" DEFAULT 'REQUIRES_CAPTURE' NOT NULL,
	"captured_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_transfer_id" varchar(255),
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pickup_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"driver_selfie_ref" text NOT NULL,
	"package_photo_refs" text[] DEFAULT '{}' NOT NULL,
	"sender_name" varchar(255) NOT NULL,
	"sender_signature_ref" text,
	"pin_used" boolean DEFAULT false NOT NULL,
	"gps_radius_pass" boolean NOT NULL,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_verifications_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "pricing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricing_plan_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"published_by" varchar(255),
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricing_plan_id" uuid NOT NULL,
	"rule_type" varchar(64) NOT NULL,
	"params" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"breakdown" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"pricing_rule_version_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"rater_type" varchar(16) NOT NULL,
	"value" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"issued_by" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_batch_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"eta" timestamp,
	CONSTRAINT "route_assignments_stop_id_unique" UNIQUE("stop_id"),
	CONSTRAINT "route_assignments_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "route_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid,
	"status" varchar(32) DEFAULT 'SUGGESTED' NOT NULL,
	"created_by" varchar(32) DEFAULT 'SYSTEM' NOT NULL,
	"grouping_reason" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"market_status" "market_status" DEFAULT 'PLANNED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" "stop_type" NOT NULL,
	"address_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"recipient_name" varchar(255),
	"recipient_phone" varchar(32),
	"time_window_start" timestamp,
	"time_window_end" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32),
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"type" "vehicle_type" NOT NULL,
	"plate" varchar(32) NOT NULL,
	"capacity_weight_kg" real NOT NULL,
	"capacity_volume_l" real NOT NULL,
	"insurance_doc_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_area_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"bounds_north" real NOT NULL,
	"bounds_south" real NOT NULL,
	"bounds_east" real NOT NULL,
	"bounds_west" real NOT NULL,
	"operating_hours" jsonb,
	"blackout_periods" jsonb
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_of_custody_events" ADD CONSTRAINT "chain_of_custody_events_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_of_custody_events" ADD CONSTRAINT "chain_of_custody_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_of_custody_events" ADD CONSTRAINT "chain_of_custody_events_actor_driver_id_drivers_id_fk" FOREIGN KEY ("actor_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims_disputes" ADD CONSTRAINT "claims_disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_verifications" ADD CONSTRAINT "delivery_verifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_route_batch_id_route_batches_id_fk" FOREIGN KEY ("route_batch_id") REFERENCES "public"."route_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_verification_records" ADD CONSTRAINT "driver_verification_records_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_events" ADD CONSTRAINT "location_events_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_verifications" ADD CONSTRAINT "pickup_verifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rule_versions" ADD CONSTRAINT "pricing_rule_versions_pricing_plan_id_pricing_plans_id_fk" FOREIGN KEY ("pricing_plan_id") REFERENCES "public"."pricing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_pricing_plan_id_pricing_plans_id_fk" FOREIGN KEY ("pricing_plan_id") REFERENCES "public"."pricing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_pricing_rule_version_id_pricing_rule_versions_id_fk" FOREIGN KEY ("pricing_rule_version_id") REFERENCES "public"."pricing_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_route_batch_id_route_batches_id_fk" FOREIGN KEY ("route_batch_id") REFERENCES "public"."route_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_assignments" ADD CONSTRAINT "route_assignments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_batches" ADD CONSTRAINT "route_batches_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_occurred_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "custody_order_idx" ON "chain_of_custody_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "custody_package_idx" ON "chain_of_custody_events" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "driver_earnings_driver_status_idx" ON "driver_earnings" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "driver_offers_order_status_idx" ON "driver_offers" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "driver_offers_driver_status_idx" ON "driver_offers" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "drivers_status_idx" ON "drivers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "drivers_online_idx" ON "drivers" USING btree ("online_status");--> statement-breakpoint
CREATE INDEX "location_events_driver_time_idx" ON "location_events" USING btree ("driver_id","recorded_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_profile_id");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_plan_version_unique" ON "pricing_rule_versions" USING btree ("pricing_plan_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_order_rater_unique" ON "ratings" USING btree ("order_id","rater_type");--> statement-breakpoint
CREATE INDEX "stops_order_idx" ON "stops" USING btree ("order_id");