CREATE TYPE "public"."credit_transaction_type" AS ENUM('purchase', 'consumption', 'release', 'refund', 'adjustment', 'expiry');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('subscription', 'credits', 'burst_pass');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'success', 'failed', 'refunded', 'abandoned');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_type" varchar(64) NOT NULL,
	"account_id" text,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"locked_by" varchar(128),
	"last_error" text,
	"idempotency_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"reference" varchar(255),
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" varchar(32) DEFAULT 'paystack' NOT NULL,
	"reference" varchar(255) NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"product_id" varchar(64) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"provider_transaction_id" varchar(255),
	"metadata" jsonb,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pack_id" varchar(32) NOT NULL,
	"credits_purchased" integer NOT NULL,
	"credits_remaining" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_provider" varchar(32) DEFAULT 'paystack' NOT NULL,
	"payment_reference" varchar(255) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"purchase_id" text,
	"type" "credit_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"reference_id" varchar(255),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_burst_passes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"utc_day" varchar(10) NOT NULL,
	"additional_capacity" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_reference" varchar(255) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_account_id_organizations_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_purchase_id_credit_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."credit_purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_burst_passes" ADD CONSTRAINT "daily_burst_passes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","available_at","priority");--> statement-breakpoint
CREATE INDEX "jobs_account_idx" ON "jobs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "jobs_locked_until_idx" ON "jobs" USING btree ("locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_type_idempotency_unique" ON "jobs" USING btree ("job_type","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_reference_idx" ON "payment_webhook_events" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_unique" ON "payments" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payments_org_idx" ON "payments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_purchases_payment_ref_unique" ON "credit_purchases" USING btree ("payment_reference");--> statement-breakpoint
CREATE INDEX "credit_purchases_org_expiry_idx" ON "credit_purchases" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE INDEX "credit_transactions_org_idx" ON "credit_transactions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_type_ref_unique" ON "credit_transactions" USING btree ("type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_burst_passes_payment_ref_unique" ON "daily_burst_passes" USING btree ("payment_reference");--> statement-breakpoint
CREATE INDEX "daily_burst_passes_org_day_idx" ON "daily_burst_passes" USING btree ("organization_id","utc_day");