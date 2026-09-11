ALTER TABLE "api_keys" ADD COLUMN "scope" varchar(16) DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "alias" varchar(100);--> statement-breakpoint
CREATE INDEX "templates_project_alias_unique" ON "templates" USING btree ("project_id","alias");