CREATE TABLE "api_key_senders" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "broadcast_id" text;
--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "contact_id" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_name" varchar(255);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_line1" varchar(255);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_line2" varchar(255);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "city" varchar(100);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "region" varchar(100);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "postal_code" varchar(32);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "country" varchar(2);
--> statement-breakpoint
ALTER TABLE "sender_identities" ADD COLUMN "is_default_marketing" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sender_identities" ADD COLUMN "reply_to" varchar(320);
--> statement-breakpoint
ALTER TABLE "sender_identities" ADD COLUMN "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "api_key_senders" ADD CONSTRAINT "api_key_senders_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_key_senders" ADD CONSTRAINT "api_key_senders_sender_id_sender_identities_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."sender_identities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_senders_key_sender_unique" ON "api_key_senders" USING btree ("api_key_id","sender_id");
--> statement-breakpoint
CREATE INDEX "api_key_senders_sender_idx" ON "api_key_senders" USING btree ("sender_id");
--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "emails_broadcast_idx" ON "emails" USING btree ("broadcast_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "senders_project_default_marketing_unique" ON "sender_identities" USING btree ("project_id") WHERE "is_default_marketing" = true AND "archived_at" IS NULL;
-- Rollback (forward-only repo; run manually if this migration must be undone):
-- ALTER TABLE "emails" DROP COLUMN IF EXISTS "contact_id";
-- ALTER TABLE "emails" DROP COLUMN IF EXISTS "broadcast_id";
-- ALTER TABLE "sender_identities" DROP COLUMN IF EXISTS "archived_at";
-- ALTER TABLE "sender_identities" DROP COLUMN IF EXISTS "reply_to";
-- ALTER TABLE "sender_identities" DROP COLUMN IF EXISTS "is_default_marketing";
-- ALTER TABLE "organizations" DROP COLUMN IF EXISTS "country";
-- ALTER TABLE "organizations" DROP COLUMN IF EXISTS "postal_code";
-- ALTER TABLE "organizations" DROP COLUMN IF EXISTS "region";
-- ALTER TABLE "organizations" DROP COLUMN IF EXISTS "city";
-- ALTER TABLE "organizations" DROP COLUMN IF EXISTS "address_line2";
-- ALTER TABLE "organizations" DROP COLUMN IF EXISTS "address_line1";
-- ALTER TABLE "organizations" DROP COLUMN IF EXISTS "legal_name";
-- DROP TABLE IF EXISTS "api_key_senders";
