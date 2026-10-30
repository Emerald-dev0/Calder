CREATE TABLE "gmail_send_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_hash" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gmail_send_attempts_account_time_idx" ON "gmail_send_attempts" USING btree ("account_hash","attempted_at");