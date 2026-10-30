ALTER TABLE "gmail_send_attempts" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
-- Historical records are known sent/delivered outcomes; their timestamp is the
-- conservative creation-time approximation from migration 0033.
UPDATE "gmail_send_attempts" SET "confirmed_at" = "attempted_at" WHERE "id" LIKE 'legacy\_%' ESCAPE '\';
