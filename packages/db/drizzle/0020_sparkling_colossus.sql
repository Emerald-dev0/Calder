ALTER TABLE "webhook_deliveries" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "response_status" integer;