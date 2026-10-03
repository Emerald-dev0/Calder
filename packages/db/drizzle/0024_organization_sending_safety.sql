CREATE TYPE "public"."organization_sending_status" AS ENUM('active', 'abuse_paused', 'suspended');
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "sending_status" "organization_sending_status" DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "sending_status_reason" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "sending_status_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "sending_status_actor_user_id" text;
