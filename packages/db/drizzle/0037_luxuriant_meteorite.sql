DROP INDEX "credit_transactions_type_ref_unique";--> statement-breakpoint
CREATE INDEX "credit_transactions_type_ref_idx" ON "credit_transactions" USING btree ("type","reference_id");