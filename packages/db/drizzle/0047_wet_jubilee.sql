ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deletion_scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deletion_requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deletion_scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deletion_requested_by_user_id" text;--> statement-breakpoint
CREATE INDEX "users_deletion_scheduled_idx" ON "users" USING btree ("deletion_scheduled_for");--> statement-breakpoint
CREATE INDEX "organizations_deletion_scheduled_idx" ON "organizations" USING btree ("deletion_scheduled_for");--> statement-breakpoint
CREATE INDEX "projects_deletion_scheduled_idx" ON "projects" USING btree ("deletion_scheduled_for");