-- Organization profile columns — legal name and postal address.
-- These columns complete the organizations table schema defined in
-- packages/db/src/schema/organizations.ts but were never migrated to
-- production. Additive only; no data is modified or backfilled.
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
ALTER TABLE "organizations" ADD COLUMN "country" varchar(2); -- ISO 3166-1 alpha-2