CREATE TABLE "usage_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"metric" varchar(100) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "env" varchar(8) DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_summaries" ADD CONSTRAINT "usage_summaries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_summaries_org_metric_period_unique" ON "usage_summaries" USING btree ("organization_id","metric","period_start");