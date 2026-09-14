CREATE TYPE "public"."platform_role" AS ENUM('founder', 'platform_admin', 'support', 'billing', 'infrastructure', 'security', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'invited', 'contacted', 'removed');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_role" "platform_role";--> statement-breakpoint
ALTER TABLE "waitlist_signups" ADD COLUMN "name" varchar(255);--> statement-breakpoint
ALTER TABLE "waitlist_signups" ADD COLUMN "source" varchar(100);--> statement-breakpoint
ALTER TABLE "waitlist_signups" ADD COLUMN "country" varchar(100);--> statement-breakpoint
ALTER TABLE "waitlist_signups" ADD COLUMN "status" "waitlist_status" DEFAULT 'waiting' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_signups" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "waitlist_signups" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "waitlist_signups" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_signups" ADD COLUMN "contacted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "waitlist_status_idx" ON "waitlist_signups" USING btree ("status");--> statement-breakpoint
CREATE INDEX "waitlist_source_idx" ON "waitlist_signups" USING btree ("source");