CREATE TABLE "company_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"to_email" varchar(320) NOT NULL,
	"user_id" text,
	"organization_id" text,
	"template" varchar(100) NOT NULL,
	"category" varchar(32) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"skip_reason" varchar(64),
	"provider" varchar(32),
	"provider_message_id" varchar(255),
	"error" text,
	"idempotency_key" varchar(255) NOT NULL,
	"metadata" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"disabled_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "company_emails" ADD CONSTRAINT "company_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_emails" ADD CONSTRAINT "company_emails_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_emails_idempotency_unique" ON "company_emails" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "company_emails_to_idx" ON "company_emails" USING btree ("to_email","created_at");--> statement-breakpoint
CREATE INDEX "company_emails_user_idx" ON "company_emails" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "company_emails_template_idx" ON "company_emails" USING btree ("template","created_at");--> statement-breakpoint
CREATE INDEX "company_emails_status_idx" ON "company_emails" USING btree ("status","created_at");

-- Rollback (forward-only repo; apply by hand only if this migration must be undone):
-- DROP TABLE IF EXISTS "email_preferences";
-- DROP TABLE IF EXISTS "company_emails";
