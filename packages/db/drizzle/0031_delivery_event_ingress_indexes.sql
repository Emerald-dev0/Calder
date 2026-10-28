-- 0031_delivery_event_ingress_indexes
--
-- Why: delivery feedback ("delivered", "bounced", "complained") is written only
-- by the SES feedback ingress, and the product needs to answer one question
-- cheaply and often: when did a delivery event last arrive? /ready asks it for
-- the whole fleet, the senders page asks it per project.
--
-- Additive only: two indexes, no column or constraint change. Applies to a
-- populated database without a rewrite of any row.
--
-- Rollback:
--   DROP INDEX IF EXISTS "email_events_project_type_created_idx";
--   DROP INDEX IF EXISTS "email_events_type_created_idx";
--
CREATE INDEX "email_events_type_created_idx" ON "email_events" USING btree ("type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_events_project_type_created_idx" ON "email_events" USING btree ("project_id","type","created_at" DESC NULLS LAST);
