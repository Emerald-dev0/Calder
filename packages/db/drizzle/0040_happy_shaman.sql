CREATE TYPE "public"."inbound_message_status" AS ENUM('received', 'parsed', 'routed', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."receiving_domain_status" AS ENUM('pending', 'verifying', 'verified', 'failed', 'disabled');--> statement-breakpoint
CREATE TABLE "inbound_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"inbound_message_id" text NOT NULL,
	"part_index" integer DEFAULT 0 NOT NULL,
	"filename" text,
	"content_type" varchar(255),
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"content_id" text,
	"disposition" varchar(24),
	"storage_key" text,
	"checksum_sha256" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"receiving_domain_id" text,
	"recipient_domain" varchar(255) NOT NULL,
	"ses_message_id" varchar(255) NOT NULL,
	"sns_message_id" varchar(255),
	"message_id_header" text,
	"envelope_from" text,
	"envelope_recipient" text,
	"from_address" text,
	"from_name" text,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_text" text,
	"body_html" text,
	"body_truncated" boolean DEFAULT false NOT NULL,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"raw_storage_key" text,
	"raw_stored_at" timestamp with time zone,
	"status" "inbound_message_status" DEFAULT 'received' NOT NULL,
	"failure_reason" text,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"spam_verdict" varchar(24),
	"virus_verdict" varchar(24),
	"spf_verdict" varchar(24),
	"dkim_verdict" varchar(24),
	"dmarc_verdict" varchar(24),
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receiving_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"status" "receiving_domain_status" DEFAULT 'pending' NOT NULL,
	"verification_token" varchar(64) NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"verify_attempts" integer DEFAULT 0 NOT NULL,
	"verify_window_start" timestamp with time zone,
	"mx_host" varchar(255) NOT NULL,
	"mx_priority" integer DEFAULT 10 NOT NULL,
	"observed_mx" jsonb,
	"observed_txt" jsonb,
	"ses_rule_set_name" varchar(128),
	"ses_rule_name" varchar(128),
	"provisioned_at" timestamp with time zone,
	"provisioned_by" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_attachments" ADD CONSTRAINT "inbound_attachments_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."inbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_receiving_domain_id_receiving_domains_id_fk" FOREIGN KEY ("receiving_domain_id") REFERENCES "public"."receiving_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_domains" ADD CONSTRAINT "receiving_domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_attachments_part_unique" ON "inbound_attachments" USING btree ("inbound_message_id","part_index");--> statement-breakpoint
CREATE INDEX "inbound_attachments_message_idx" ON "inbound_attachments" USING btree ("inbound_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_ses_id_unique" ON "inbound_messages" USING btree ("ses_message_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_project_received_idx" ON "inbound_messages" USING btree ("project_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_org_received_idx" ON "inbound_messages" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_recipient_idx" ON "inbound_messages" USING btree ("recipient_domain");--> statement-breakpoint
CREATE INDEX "inbound_messages_search_idx" ON "inbound_messages" USING gin (to_tsvector('simple', coalesce("subject", '') || ' ' || coalesce("body_text", '') || ' ' || coalesce("from_address", '')));--> statement-breakpoint
CREATE UNIQUE INDEX "receiving_domains_domain_unique" ON "receiving_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "receiving_domains_project_idx" ON "receiving_domains" USING btree ("project_id");