CREATE TABLE "ses_suppressions" (
	"email" varchar(320) PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"last_update_time" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'reconcile' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ses_suppressions_last_seen_idx" ON "ses_suppressions" USING btree ("last_seen_at");