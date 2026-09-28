ALTER TYPE "public"."domain_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD COLUMN "verification_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD COLUMN "verify_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD COLUMN "verify_window_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD COLUMN "last_verify_error" text;--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD COLUMN "ses_identity_status" varchar(24) DEFAULT 'not_linked';--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD COLUMN "dkim_records" jsonb;--> statement-breakpoint
ALTER TABLE "domain_verifications" ADD COLUMN "dkim_status" varchar(24);--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verification_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verify_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "verify_window_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "last_verify_error" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "ses_identity_status" varchar(24) DEFAULT 'not_linked';--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dkim_records" jsonb;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dkim_status" varchar(24);