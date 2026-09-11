CREATE TYPE "public"."sender_status" AS ENUM('pending', 'verified', 'connected', 'disabled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sender_type" AS ENUM('domain', 'gmail', 'managed');--> statement-breakpoint
CREATE TABLE "sender_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"type" "sender_type" NOT NULL,
	"transport_id" text,
	"status" "sender_status" DEFAULT 'pending' NOT NULL,
	"status_reason" varchar(500),
	"is_default" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "sender_identity_id" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "from_name" varchar(255);--> statement-breakpoint
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_transport_id_project_transports_id_fk" FOREIGN KEY ("transport_id") REFERENCES "public"."project_transports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "senders_project_idx" ON "sender_identities" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "senders_project_email_unique" ON "sender_identities" USING btree ("project_id","email");--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_sender_identity_id_sender_identities_id_fk" FOREIGN KEY ("sender_identity_id") REFERENCES "public"."sender_identities"("id") ON DELETE set null ON UPDATE no action;