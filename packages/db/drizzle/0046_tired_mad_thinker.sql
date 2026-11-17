ALTER TABLE "template_versions" ADD COLUMN "status" varchar(16) DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "template_versions" ADD COLUMN "variables" jsonb;--> statement-breakpoint
CREATE INDEX "template_versions_template_status_idx" ON "template_versions" USING btree ("template_id","status");--> statement-breakpoint
-- Every row that exists today is live: it is what sends resolve. Backfill the
-- publish timestamp so ordering by publication does not put them all at the
-- epoch, and so /templates can say when the current version went out.
UPDATE "template_versions" SET "published_at" = "created_at" WHERE "status" = 'published' AND "published_at" IS NULL;
