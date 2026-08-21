ALTER TABLE "claims_disputes" ADD COLUMN "reported_by_user_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "claims_disputes" ADD COLUMN "description" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "claims_disputes" ADD CONSTRAINT "claims_disputes_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
