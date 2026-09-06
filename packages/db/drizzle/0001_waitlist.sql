-- Waitlist signups — public early-access list (no tenant ownership by design)
--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"referral_code" varchar(16) NOT NULL,
	"referred_by" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_signups_email_unique" UNIQUE("email"),
	CONSTRAINT "waitlist_signups_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE INDEX "waitlist_created_at_idx" ON "waitlist_signups" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "waitlist_referred_by_idx" ON "waitlist_signups" USING btree ("referred_by");
