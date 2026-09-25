CREATE TYPE "public"."email_stream" AS ENUM('transactional', 'marketing');
--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "stream" "email_stream" DEFAULT 'transactional' NOT NULL;
--> statement-breakpoint
CREATE INDEX "emails_stream_created_idx" ON "emails" USING btree ("stream","created_at");
