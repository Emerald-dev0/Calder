-- Project onboarding metadata (environment, use cases, volume) — nullable, no backfill needed
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "metadata" jsonb;
