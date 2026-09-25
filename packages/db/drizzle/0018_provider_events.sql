CREATE TABLE "provider_events" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL,
  "topic_arn" text,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_message_id_unique" ON "provider_events" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "provider_events_received_idx" ON "provider_events" USING btree ("received_at");
