CREATE TYPE "public"."audience_contact_status" AS ENUM('subscribed', 'unsubscribed', 'pending_confirmation');
--> statement-breakpoint
CREATE TYPE "public"."contact_consent_source" AS ENUM('import', 'api', 'form', 'manual', 'double_opt_in');
--> statement-breakpoint
CREATE TYPE "public"."contact_import_status" AS ENUM('pending', 'processing', 'completed', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('subscribed', 'unsubscribed', 'bounced', 'complained', 'pending_confirmation');
--> statement-breakpoint
CREATE TABLE "audience_contacts" (
	"audience_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"status" "audience_contact_status" DEFAULT 'subscribed' NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "audience_contacts_audience_id_contact_id_pk" PRIMARY KEY("audience_id","contact_id")
);

--> statement-breakpoint
CREATE TABLE "audiences" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"double_opt_in" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "contact_import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"audience_id" text NOT NULL,
	"created_by" text,
	"status" "contact_import_status" DEFAULT 'pending' NOT NULL,
	"file_name" varchar(255),
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"skipped_unsubscribed" integer DEFAULT 0 NOT NULL,
	"skipped_bounced" integer DEFAULT 0 NOT NULL,
	"skipped_complained" integer DEFAULT 0 NOT NULL,
	"role_address_rows" integer DEFAULT 0 NOT NULL,
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"error_report" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_import_jobs_consent_confirmed_check" CHECK ("consent_confirmed" = true)
);

--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"first_name" varchar(255),
	"last_name" varchar(255),
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "contact_status" DEFAULT 'subscribed' NOT NULL,
	"consent_source" "contact_consent_source" NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_ip_hash" varchar(64),
	"consent_note" text,
	"confirmation_token_hash" varchar(255),
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_lowercase_check" CHECK ("email" = lower("email"))
);

--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"audience_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "audience_contacts" ADD CONSTRAINT "audience_contacts_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audience_contacts" ADD CONSTRAINT "audience_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audiences" ADD CONSTRAINT "audiences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audiences" ADD CONSTRAINT "audiences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_import_jobs" ADD CONSTRAINT "contact_import_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_import_jobs" ADD CONSTRAINT "contact_import_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_import_jobs" ADD CONSTRAINT "contact_import_jobs_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "audience_contacts_audience_status_idx" ON "audience_contacts" USING btree ("audience_id","status");
--> statement-breakpoint
CREATE INDEX "audience_contacts_contact_idx" ON "audience_contacts" USING btree ("contact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "audiences_project_name_unique" ON "audiences" USING btree ("project_id","name") WHERE "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "audiences_project_idx" ON "audiences" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "contact_import_jobs_audience_idx" ON "contact_import_jobs" USING btree ("audience_id");
--> statement-breakpoint
CREATE INDEX "contact_import_jobs_org_status_idx" ON "contact_import_jobs" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_project_email_unique" ON "contacts" USING btree ("project_id","email");
--> statement-breakpoint
CREATE INDEX "contacts_org_status_idx" ON "contacts" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "contacts_properties_gin" ON "contacts" USING gin ("properties");
--> statement-breakpoint
CREATE INDEX "segments_audience_idx" ON "segments" USING btree ("audience_id");
-- Rollback (forward-only repo; run manually if this migration must be undone):
-- DROP TABLE IF EXISTS "contact_import_jobs";
-- DROP TABLE IF EXISTS "segments";
-- DROP TABLE IF EXISTS "audience_contacts";
-- DROP TABLE IF EXISTS "audiences";
-- DROP TABLE IF EXISTS "contacts";
-- DROP TYPE IF EXISTS "contact_import_status";
-- DROP TYPE IF EXISTS "audience_contact_status";
-- DROP TYPE IF EXISTS "contact_consent_source";
-- DROP TYPE IF EXISTS "contact_status";
