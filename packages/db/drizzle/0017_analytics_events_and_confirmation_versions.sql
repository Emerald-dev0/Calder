CREATE TABLE "waitlist_confirmation_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" varchar(998) NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_confirmation_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"subject" varchar(998) NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"published_by" varchar(320),
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" varchar(24) NOT NULL,
	"path" varchar(512),
	"label" varchar(100),
	"referrer" varchar(512),
	"source" varchar(100),
	"utm" jsonb,
	"session_id" varchar(64) NOT NULL,
	"visitor_id" varchar(64) NOT NULL,
	"device" varchar(16),
	"country" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_confirmation_versions_version_key" ON "waitlist_confirmation_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "analytics_events_created_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_type_created_idx" ON "analytics_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_visitor_idx" ON "analytics_events" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_events_path_idx" ON "analytics_events" USING btree ("path");