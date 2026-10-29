CREATE TYPE "public"."control_incident_severity" AS ENUM('sev1', 'sev2', 'sev3', 'sev4');--> statement-breakpoint
CREATE TYPE "public"."control_incident_status" AS ENUM('investigating', 'identified', 'monitoring', 'resolved');--> statement-breakpoint
CREATE TABLE "control_incident_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"actor_user_id" text,
	"from_status" "control_incident_status" NOT NULL,
	"to_status" "control_incident_status" NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" text NOT NULL,
	"severity" "control_incident_severity" NOT NULL,
	"status" "control_incident_status" DEFAULT 'investigating' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "control_incident_updates" ADD CONSTRAINT "control_incident_updates_incident_id_control_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."control_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_incident_updates" ADD CONSTRAINT "control_incident_updates_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_incidents" ADD CONSTRAINT "control_incidents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_incident_updates_incident_created_idx" ON "control_incident_updates" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "control_incidents_status_created_idx" ON "control_incidents" USING btree ("status","created_at");