CREATE TYPE "public"."broadcast_recipient_status" AS ENUM('pending', 'queued', 'sent', 'delivered', 'bounced', 'failed', 'skipped', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."broadcast_skip_reason" AS ENUM('unsubscribed', 'bounced', 'complained', 'suppressed', 'invalid', 'duplicate');
--> statement-breakpoint
CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'scheduled', 'queued', 'sending', 'paused', 'sent', 'cancelled', 'failed');
--> statement-breakpoint
CREATE TABLE "broadcast_links" (
	"id" text PRIMARY KEY NOT NULL,
	"broadcast_id" text NOT NULL,
	"original_url" text NOT NULL,
	"short_token" varchar(64) NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"broadcast_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"email_id" text,
	"status" "broadcast_recipient_status" DEFAULT 'pending' NOT NULL,
	"skip_reason" "broadcast_skip_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"sender_id" text NOT NULL,
	"reply_to" varchar(320),
	"subject" varchar(998) NOT NULL,
	"preview_text" varchar(255),
	"template_id" text,
	"html" text,
	"text" text,
	"audience_id" text NOT NULL,
	"segment_id" text,
	"tracking_opens" boolean DEFAULT true NOT NULL,
	"tracking_clicks" boolean DEFAULT true NOT NULL,
	"scheduled_at" timestamp with time zone,
	"timezone" varchar(64),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"paused_reason" text,
	"recipient_count" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "link_clicks" (
	"id" text PRIMARY KEY NOT NULL,
	"broadcast_link_id" text NOT NULL,
	"email_id" text,
	"contact_id" text,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent_hash" varchar(64),
	"ip_hash" varchar(64)
);

--> statement-breakpoint
ALTER TABLE "broadcast_links" ADD CONSTRAINT "broadcast_links_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_sender_id_sender_identities_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."sender_identities"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_broadcast_link_id_broadcast_links_id_fk" FOREIGN KEY ("broadcast_link_id") REFERENCES "public"."broadcast_links"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_links_short_token_unique" ON "broadcast_links" USING btree ("short_token");
--> statement-breakpoint
CREATE INDEX "broadcast_links_broadcast_idx" ON "broadcast_links" USING btree ("broadcast_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_recipients_broadcast_contact_unique" ON "broadcast_recipients" USING btree ("broadcast_id","contact_id");
--> statement-breakpoint
CREATE INDEX "broadcast_recipients_broadcast_status_idx" ON "broadcast_recipients" USING btree ("broadcast_id","status");
--> statement-breakpoint
CREATE INDEX "broadcast_recipients_contact_idx" ON "broadcast_recipients" USING btree ("contact_id");
--> statement-breakpoint
CREATE INDEX "broadcasts_org_created_idx" ON "broadcasts" USING btree ("organization_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "broadcasts_sender_status_idx" ON "broadcasts" USING btree ("sender_id","status");
--> statement-breakpoint
CREATE INDEX "broadcasts_status_scheduled_idx" ON "broadcasts" USING btree ("status","scheduled_at");
--> statement-breakpoint
CREATE INDEX "link_clicks_link_clicked_idx" ON "link_clicks" USING btree ("broadcast_link_id","clicked_at");
-- Rollback (forward-only repo; run manually if this migration must be undone):
-- DROP TABLE IF EXISTS "link_clicks";
-- DROP TABLE IF EXISTS "broadcast_links";
-- DROP TABLE IF EXISTS "broadcast_recipients";
-- DROP TABLE IF EXISTS "broadcasts";
-- DROP TYPE IF EXISTS "broadcast_skip_reason";
-- DROP TYPE IF EXISTS "broadcast_recipient_status";
-- DROP TYPE IF EXISTS "broadcast_status";
