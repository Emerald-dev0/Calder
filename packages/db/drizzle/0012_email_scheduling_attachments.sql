ALTER TABLE "emails" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "scheduled_for" timestamp with time zone;