-- User profile onboarding: handle, role, referral source, completion stamp
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" varchar(39);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" varchar(32);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_source" varchar(100);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");
