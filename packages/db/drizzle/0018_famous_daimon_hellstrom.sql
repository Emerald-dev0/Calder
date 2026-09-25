CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(32) DEFAULT 'ses' NOT NULL,
	"sns_message_id" varchar(255) NOT NULL,
	"ses_message_id" varchar(255),
	"event_type" varchar(40) NOT NULL,
	"email_id" text,
	"project_id" text,
	"recipient" varchar(320),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unmatched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_events_sns_message_id_unique" UNIQUE("sns_message_id")
);
--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_events_ses_message_idx" ON "provider_events" USING btree ("ses_message_id");--> statement-breakpoint
CREATE INDEX "provider_events_email_idx" ON "provider_events" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "provider_events_created_idx" ON "provider_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_project_email_unique" ON "suppressions" USING btree ("project_id","email");