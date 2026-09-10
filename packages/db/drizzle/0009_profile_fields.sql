ALTER TABLE "users" ADD COLUMN "discovery_detail" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "project_types" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "primary_goal" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_state" varchar(32) DEFAULT 'not_started' NOT NULL;