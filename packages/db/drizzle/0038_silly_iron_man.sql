ALTER TYPE "public"."webhook_delivery_status" ADD VALUE 'sending' BEFORE 'delivered';--> statement-breakpoint
CREATE TABLE "webhook_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"project_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"response_status" integer,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_processor_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" varchar(128) NOT NULL,
	"trigger" varchar(32) DEFAULT 'manual' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"claimed" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"released" integer DEFAULT 0 NOT NULL,
	"reaped_leases" integer DEFAULT 0 NOT NULL,
	"emails_sent" integer DEFAULT 0 NOT NULL,
	"webhooks_delivered" integer DEFAULT 0 NOT NULL,
	"webhooks_retried" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "locked_by" varchar(128);--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lock_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_delivery_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_project_idx" ON "webhook_delivery_attempts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "queue_processor_runs_started_idx" ON "queue_processor_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");