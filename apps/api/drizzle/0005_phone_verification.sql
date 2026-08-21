ALTER TABLE "users" ADD COLUMN "phone_verification_code_hash" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verification_expires_at" timestamp;
