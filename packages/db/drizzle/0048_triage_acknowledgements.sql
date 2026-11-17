CREATE TABLE "triage_acknowledgements" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" varchar(200) NOT NULL,
	"kind" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"note" text,
	"acknowledged_by_user_id" text,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "triage_acknowledgements" ADD CONSTRAINT "triage_acknowledgements_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_acknowledgements" ADD CONSTRAINT "triage_acknowledgements_reopened_by_user_id_users_id_fk" FOREIGN KEY ("reopened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "triage_ack_item_idx" ON "triage_acknowledgements" USING btree ("item_id","acknowledged_at");--> statement-breakpoint
CREATE INDEX "triage_ack_active_idx" ON "triage_acknowledgements" USING btree ("reopened_at");